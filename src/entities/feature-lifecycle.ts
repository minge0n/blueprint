import { FEATURE_STATUSES, type FeatureStatus } from './types.js';

type StringMap = Record<string, string>;

function defineStringLiterals<const TMap extends StringMap>(values: TMap): TMap {
  return values;
}

type ValueOf<TObject> = TObject[keyof TObject];

export const FEATURE_LIFECYCLE_EVENTS = defineStringLiterals({
  PLAN_REVIEW_STARTED: 'plan_review_started',
  PLAN_APPROVED: 'plan_approved',
  PLAN_REJECTED: 'plan_rejected',
  BUILD_REVIEW_STARTED: 'build_review_started',
  BUILD_APPROVED: 'build_approved',
  BUILD_REJECTED: 'build_rejected',
});

export type FeatureLifecycleEvent = ValueOf<typeof FEATURE_LIFECYCLE_EVENTS>;

export interface FeatureLifecycleTransitionGuards {
  readonly hasApprovedBuildCycle: boolean;
  readonly hasBlockingOpenIssues: boolean;
}

export interface FeatureLifecycleTransitionSuccess {
  readonly ok: true;
  readonly nextStatus: FeatureStatus;
}

export interface FeatureLifecycleTransitionFailure {
  readonly ok: false;
  readonly error: string;
}

export type FeatureLifecycleTransitionResult =
  | FeatureLifecycleTransitionSuccess
  | FeatureLifecycleTransitionFailure;

const DEFAULT_FEATURE_LIFECYCLE_GUARDS: FeatureLifecycleTransitionGuards = {
  hasApprovedBuildCycle: false,
  hasBlockingOpenIssues: false,
};

const FEATURE_LIFECYCLE_TRANSITIONS: Record<FeatureStatus, Array<FeatureStatus>> = {
  [FEATURE_STATUSES.DRAFT]: [FEATURE_STATUSES.PLAN_REVIEW],
  [FEATURE_STATUSES.PLAN_REVIEW]: [FEATURE_STATUSES.PLAN_REVIEW, FEATURE_STATUSES.BUILDING],
  [FEATURE_STATUSES.BUILDING]: [FEATURE_STATUSES.BUILD_REVIEW],
  [FEATURE_STATUSES.BUILD_REVIEW]: [FEATURE_STATUSES.BUILDING, FEATURE_STATUSES.DONE],
  [FEATURE_STATUSES.DONE]: [],
};

function createInvalidTransitionError(currentStatus: FeatureStatus, targetStatus: FeatureStatus): string {
  return `Cannot transition from ${currentStatus} to ${targetStatus}`;
}

function isTargetStatusAllowed(currentStatus: FeatureStatus, targetStatus: FeatureStatus): boolean {
  const allowedTargets = FEATURE_LIFECYCLE_TRANSITIONS[currentStatus];

  return allowedTargets.includes(targetStatus);
}

function validateDoneTransition(
  currentStatus: FeatureStatus,
  targetStatus: FeatureStatus,
  guards: FeatureLifecycleTransitionGuards
): FeatureLifecycleTransitionResult {
  if (targetStatus !== FEATURE_STATUSES.DONE) {
    return {
      ok: true,
      nextStatus: targetStatus,
    };
  }

  if (!guards.hasApprovedBuildCycle) {
    return {
      ok: false,
      error: `${createInvalidTransitionError(currentStatus, targetStatus)}: at least one approved build cycle is required.`,
    };
  }

  if (guards.hasBlockingOpenIssues) {
    return {
      ok: false,
      error: `${createInvalidTransitionError(currentStatus, targetStatus)}: open critical or major issues remain.`,
    };
  }

  return {
    ok: true,
    nextStatus: targetStatus,
  };
}

function getTargetStatusForEvent(event: FeatureLifecycleEvent): FeatureStatus {
  switch (event) {
    case FEATURE_LIFECYCLE_EVENTS.PLAN_REVIEW_STARTED:
    case FEATURE_LIFECYCLE_EVENTS.PLAN_REJECTED:
      return FEATURE_STATUSES.PLAN_REVIEW;
    case FEATURE_LIFECYCLE_EVENTS.PLAN_APPROVED:
    case FEATURE_LIFECYCLE_EVENTS.BUILD_REJECTED:
      return FEATURE_STATUSES.BUILDING;
    case FEATURE_LIFECYCLE_EVENTS.BUILD_REVIEW_STARTED:
      return FEATURE_STATUSES.BUILD_REVIEW;
    case FEATURE_LIFECYCLE_EVENTS.BUILD_APPROVED:
      return FEATURE_STATUSES.DONE;
  }
}

export class FeatureLifecycleTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FeatureLifecycleTransitionError';
  }
}

export function getAllowedFeatureStatusTransitions(currentStatus: FeatureStatus): Array<FeatureStatus> {
  const allowedTargets = FEATURE_LIFECYCLE_TRANSITIONS[currentStatus];

  return [...allowedTargets];
}

export function validateFeatureStatusTransition(
  currentStatus: FeatureStatus,
  targetStatus: FeatureStatus,
  guards: FeatureLifecycleTransitionGuards = DEFAULT_FEATURE_LIFECYCLE_GUARDS
): FeatureLifecycleTransitionResult {
  if (!isTargetStatusAllowed(currentStatus, targetStatus)) {
    return {
      ok: false,
      error: createInvalidTransitionError(currentStatus, targetStatus),
    };
  }

  return validateDoneTransition(currentStatus, targetStatus, guards);
}

export function canTransitionFeatureStatus(
  currentStatus: FeatureStatus,
  targetStatus: FeatureStatus,
  guards: FeatureLifecycleTransitionGuards = DEFAULT_FEATURE_LIFECYCLE_GUARDS
): boolean {
  const result = validateFeatureStatusTransition(currentStatus, targetStatus, guards);

  return result.ok;
}

export function transitionFeatureStatus(
  currentStatus: FeatureStatus,
  targetStatus: FeatureStatus,
  guards: FeatureLifecycleTransitionGuards = DEFAULT_FEATURE_LIFECYCLE_GUARDS
): FeatureStatus {
  const result = validateFeatureStatusTransition(currentStatus, targetStatus, guards);

  if (!result.ok) {
    throw new FeatureLifecycleTransitionError(result.error);
  }

  return result.nextStatus;
}

export function resolveFeatureStatusFromLifecycleEvent(
  currentStatus: FeatureStatus,
  event: FeatureLifecycleEvent,
  guards: FeatureLifecycleTransitionGuards = DEFAULT_FEATURE_LIFECYCLE_GUARDS
): FeatureLifecycleTransitionResult {
  const targetStatus = getTargetStatusForEvent(event);

  return validateFeatureStatusTransition(currentStatus, targetStatus, guards);
}

export function transitionFeatureStatusFromLifecycleEvent(
  currentStatus: FeatureStatus,
  event: FeatureLifecycleEvent,
  guards: FeatureLifecycleTransitionGuards = DEFAULT_FEATURE_LIFECYCLE_GUARDS
): FeatureStatus {
  const result = resolveFeatureStatusFromLifecycleEvent(currentStatus, event, guards);

  if (!result.ok) {
    throw new FeatureLifecycleTransitionError(result.error);
  }

  return result.nextStatus;
}
