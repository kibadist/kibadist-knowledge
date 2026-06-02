import {
  Generator,
  type Track,
  type TrackConcept,
  TrackConceptStatus,
  type TrackStatus,
} from '@kibadist/prisma'
import { Injectable, NotFoundException } from '@nestjs/common'

import { ConceptsService } from '../concepts/concepts.service'
import { PrismaService } from '../prisma/prisma.service'
import type { AddTrackConceptDto } from './dto/add-track-concept.dto'
import type { CreateTrackDto } from './dto/create-track.dto'
import type { UpdateTrackDto } from './dto/update-track.dto'
import type { UpdateTrackConceptDto } from './dto/update-track-concept.dto'
import {
  type TrackConceptProgress,
  trackConceptProgress,
} from './track-progress'

/** A track-concept joined with the concept fields the UI needs + derived progress. */
export type TrackConceptWithProgress = TrackConcept & {
  concept: { id: string; title: string; cognitiveState: string; status: string }
  progress: TrackConceptProgress
}

/**
 * Tracks (DET-235): the goal-directed organizational layer, and the TrackConcept
 * membership carrying per-track demand. Two responsibilities, mirroring
 * DomainsService:
 *
 *  1. Track CRUD, workspace-scoped. The owning workspace id is resolved +
 *     ownership-checked by the controller (via WorkspacesService); mutations by
 *     track id re-check ownership by joining through `workspace.ownerUserId`.
 *  2. Track membership. A concept's progress toward what a track demands is
 *     DERIVED (see {@link trackConceptProgress}) by reading `requiredDepth`
 *     against the concept's live CognitiveState — never stored, never a second
 *     source of truth for mastery.
 *
 * Hard boundary (DET-231/189): adding a concept to a track is ORGANIZATION, not
 * promotion. Nothing here writes an Articulation, moves a concept's status, or
 * touches CognitiveState. `requiredDepth` is a demand, never a lever.
 */
@Injectable()
export class TracksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly concepts: ConceptsService,
  ) {}

  /** Tracks in a workspace, newest first, optionally filtered by status. */
  findAllForWorkspace(
    workspaceId: string,
    status?: TrackStatus,
  ): Promise<Track[]> {
    return this.prisma.track.findMany({
      where: { workspaceId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    })
  }

  create(workspaceId: string, dto: CreateTrackDto): Promise<Track> {
    return this.prisma.track.create({
      data: {
        workspaceId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        type: dto.type,
        goal: dto.goal?.trim() || null,
      },
    })
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateTrackDto,
  ): Promise<Track> {
    await this.assertOwnedTrack(userId, id)
    return this.prisma.track.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description === undefined
            ? undefined
            : dto.description.trim() || null,
        type: dto.type,
        goal: dto.goal === undefined ? undefined : dto.goal.trim() || null,
        status: dto.status,
      },
    })
  }

  /**
   * Delete a track. Its TrackConcept rows cascade away (memberships dropped), but
   * the concepts are untouched — a track organizes concepts, it doesn't contain
   * them. DET-235 acceptance: deleting a track never deletes concepts.
   */
  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwnedTrack(userId, id)
    await this.prisma.track.delete({ where: { id } })
  }

  // ---- Track ⇄ Concept membership -----------------------------------------

  /** A track's concepts, in order, each with derived per-track progress. */
  async listConcepts(
    userId: string,
    trackId: string,
  ): Promise<TrackConceptWithProgress[]> {
    await this.assertOwnedTrack(userId, trackId)
    const rows = await this.prisma.trackConcept.findMany({
      where: { trackId },
      include: {
        concept: {
          select: {
            id: true,
            title: true,
            cognitiveState: true,
            status: true,
          },
        },
      },
      // Unsorted (null orderIndex) rows sink to the end, then by recency.
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
    })
    return rows.map((row) => ({
      ...row,
      progress: trackConceptProgress(
        row.requiredDepth,
        row.concept.cognitiveState,
      ),
    }))
  }

  /**
   * Add a concept to a track. Per DET-235 a membership enters as CANDIDATE (the
   * plan is the set the user has ACCEPTED); the user accepts/completes/skips it
   * via {@link updateConcept}. Idempotent on the composite PK — re-adding only
   * patches the supplied fields and never clobbers an existing status. The
   * concept (non-inbox, owned) and track must share a workspace.
   */
  async addConcept(
    userId: string,
    trackId: string,
    dto: AddTrackConceptDto,
  ): Promise<TrackConcept> {
    await this.assertTrackAndConceptAligned(userId, trackId, dto.conceptId)
    return this.prisma.trackConcept.upsert({
      where: {
        trackId_conceptId: { trackId, conceptId: dto.conceptId },
      },
      create: {
        trackId,
        conceptId: dto.conceptId,
        importance: dto.importance,
        requiredDepth: dto.requiredDepth,
        orderIndex: dto.orderIndex,
        status: TrackConceptStatus.CANDIDATE,
        createdBy: Generator.USER,
      },
      update: {
        ...(dto.importance === undefined ? {} : { importance: dto.importance }),
        ...(dto.requiredDepth === undefined
          ? {}
          : { requiredDepth: dto.requiredDepth }),
        ...(dto.orderIndex === undefined ? {} : { orderIndex: dto.orderIndex }),
      },
    })
  }

  /**
   * Update a concept's membership: accept/complete/skip, re-weight, change the
   * demanded depth, or reorder. Only the supplied fields change; none of them
   * touch the concept's CognitiveState.
   */
  async updateConcept(
    userId: string,
    trackId: string,
    conceptId: string,
    dto: UpdateTrackConceptDto,
  ): Promise<TrackConcept> {
    await this.assertOwnedTrack(userId, trackId)
    const membership = await this.prisma.trackConcept.findUnique({
      where: { trackId_conceptId: { trackId, conceptId } },
    })
    if (!membership) throw new NotFoundException('Track membership not found')
    return this.prisma.trackConcept.update({
      where: { trackId_conceptId: { trackId, conceptId } },
      data: {
        status: dto.status,
        importance: dto.importance,
        requiredDepth: dto.requiredDepth,
        orderIndex: dto.orderIndex,
      },
    })
  }

  /** Remove a concept from a track. No-op-safe if the membership doesn't exist. */
  async removeConcept(
    userId: string,
    trackId: string,
    conceptId: string,
  ): Promise<void> {
    await this.assertOwnedTrack(userId, trackId)
    await this.prisma.trackConcept.deleteMany({ where: { trackId, conceptId } })
  }

  /**
   * Track-first onboarding (DET-240): when a concept captured against a target
   * track is earned through the gate, enroll the now-permanent concept into that
   * track as an AI-proposed CANDIDATE. Reads the concept's `targetTrackId`; if it
   * still points at a track in the same workspace, upserts a TrackConcept
   * (createdBy AI, status CANDIDATE) WITHOUT clobbering any membership the user
   * already created. Returns the trackId it enrolled into, or null if there was
   * no target / the track is gone.
   *
   * This is ORGANIZATION, not promotion — the gate already earned the concept;
   * this only proposes where it belongs. Caller invokes it best-effort post-commit.
   */
  async enrollPromotedConcept(
    userId: string,
    conceptId: string,
  ): Promise<string | null> {
    const concept = await this.prisma.concept.findFirst({
      where: { id: conceptId, userId },
      select: { targetTrackId: true, workspaceId: true },
    })
    if (!concept?.targetTrackId) return null
    const track = await this.prisma.track.findFirst({
      where: {
        id: concept.targetTrackId,
        workspaceId: concept.workspaceId,
        workspace: { ownerUserId: userId },
      },
      select: { id: true },
    })
    if (!track) return null
    await this.prisma.trackConcept.upsert({
      where: { trackId_conceptId: { trackId: track.id, conceptId } },
      create: {
        trackId: track.id,
        conceptId,
        status: TrackConceptStatus.CANDIDATE,
        createdBy: Generator.AI,
      },
      // Never overwrite an existing membership (e.g. one the user already added).
      update: {},
    })
    return track.id
  }

  // ---- Ownership helpers ---------------------------------------------------

  /**
   * Load a track and assert the user owns its workspace — checked by joining
   * through `workspace.ownerUserId`, never by track id alone. Returns the row.
   */
  async assertOwnedTrack(userId: string, id: string): Promise<Track> {
    const track = await this.prisma.track.findFirst({
      where: { id, workspace: { ownerUserId: userId } },
    })
    if (!track) throw new NotFoundException('Track not found')
    return track
  }

  /**
   * Assert the track (owned) and the concept (owned, non-inbox) live in the SAME
   * workspace — the invariant that keeps a concept out of another world's track.
   */
  private async assertTrackAndConceptAligned(
    userId: string,
    trackId: string,
    conceptId: string,
  ): Promise<void> {
    const track = await this.assertOwnedTrack(userId, trackId)
    await this.concepts.assertOwnedNonInbox(userId, conceptId)
    const concept = await this.prisma.concept.findFirst({
      where: { id: conceptId, userId },
      select: { workspaceId: true },
    })
    if (!concept || concept.workspaceId !== track.workspaceId) {
      throw new NotFoundException('Concept not found in this track’s workspace')
    }
  }
}
