import type { Issue, IssueCategory, IssueSeverity } from '../../entities/issue.js';
import { ISSUE_CATEGORIES, ISSUE_SEVERITIES } from '../../entities/issue.js';
import type { AddIssueInput, ListIssuesInput } from './issue.js';
import { addIssue, listIssues } from './issue.js';

export type IntegrationIssueCategory =
  | typeof ISSUE_CATEGORIES.INTEGRATION_CONFLICT
  | typeof ISSUE_CATEGORIES.RACE_CONDITION
  | typeof ISSUE_CATEGORIES.INTERFACE_MISMATCH;

export interface IntegrationIssueValidationInput {
  readonly category: IssueCategory;
  readonly description: string;
  readonly related_fu_id?: string;
}

export interface AddIntegrationIssueInput
  extends Omit<AddIssueInput, 'category' | 'severity'> {
  readonly category: IntegrationIssueCategory;
  readonly severity?: IssueSeverity;
}

export interface ListIntegrationIssuesInput
  extends Omit<ListIssuesInput, 'category'> {
  readonly category?: IntegrationIssueCategory | Array<IntegrationIssueCategory>;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function hasLabeledDetail(description: string, labelPattern: string): boolean {
  const matcher = new RegExp(`${labelPattern}\\s*[:=-]\\s*\\S+`, 'i');

  return matcher.test(description);
}

function hasSharedStateDescription(description: string): boolean {
  return hasLabeledDetail(description, '(contested\\s+)?shared(?:-|\\s+)state');
}

function hasExpectedActualDescription(description: string): boolean {
  if (!hasLabeledDetail(description, 'expected(?:\\s+interface)?')) {
    return false;
  }

  return hasLabeledDetail(description, 'actual(?:\\s+interface)?');
}

export function getIntegrationIssueCategories(): Array<IntegrationIssueCategory> {
  return [
    ISSUE_CATEGORIES.INTEGRATION_CONFLICT,
    ISSUE_CATEGORIES.RACE_CONDITION,
    ISSUE_CATEGORIES.INTERFACE_MISMATCH,
  ];
}

export function isIntegrationIssueCategory(category: IssueCategory): category is IntegrationIssueCategory {
  switch (category) {
    case ISSUE_CATEGORIES.INTEGRATION_CONFLICT:
    case ISSUE_CATEGORIES.RACE_CONDITION:
    case ISSUE_CATEGORIES.INTERFACE_MISMATCH:
      return true;
    default:
      return false;
  }
}

export function validateIntegrationIssueRequirements(
  input: IntegrationIssueValidationInput
): void {
  if (!isIntegrationIssueCategory(input.category)) {
    return;
  }

  if (
    input.category === ISSUE_CATEGORIES.INTEGRATION_CONFLICT &&
    normalizeWhitespace(input.related_fu_id ?? '') === ''
  ) {
    throw new Error('integration_conflict issues require related_fu_id');
  }

  if (
    input.category === ISSUE_CATEGORIES.RACE_CONDITION &&
    !hasSharedStateDescription(input.description)
  ) {
    throw new Error(
      'race_condition issues must describe the contested shared state in description using "shared state: ..."'
    );
  }

  if (
    input.category === ISSUE_CATEGORIES.INTERFACE_MISMATCH &&
    !hasExpectedActualDescription(input.description)
  ) {
    throw new Error(
      'interface_mismatch issues must describe both expected and actual interfaces in description using "expected: ..." and "actual: ..."'
    );
  }
}

export function createIntegrationIssueInput(input: AddIntegrationIssueInput): AddIssueInput {
  validateIntegrationIssueRequirements({
    category: input.category,
    description: input.description,
    related_fu_id: input.related_fu_id,
  });

  return {
    parent_type: input.parent_type,
    parent_id: input.parent_id,
    fu_id: input.fu_id,
    ac_id: input.ac_id,
    related_fu_id: input.related_fu_id,
    category: input.category,
    severity: input.severity ?? ISSUE_SEVERITIES.CRITICAL,
    title: input.title,
    description: input.description,
    suggested_fix: input.suggested_fix,
  };
}

export function normalizeIntegrationIssueCategories(
  category: IntegrationIssueCategory | Array<IntegrationIssueCategory> | undefined
): Array<IntegrationIssueCategory> {
  if (category === undefined) {
    return getIntegrationIssueCategories();
  }

  if (typeof category === 'string') {
    return [category];
  }

  const dedupedCategories = new Set<IntegrationIssueCategory>();

  for (const currentCategory of category) {
    dedupedCategories.add(currentCategory);
  }

  return Array.from(dedupedCategories);
}

export function createIntegrationIssueListInput(
  input: ListIntegrationIssuesInput = {}
): ListIssuesInput {
  return {
    feature_id: input.feature_id,
    status: input.status,
    severity: input.severity,
    category: normalizeIntegrationIssueCategories(input.category),
  };
}

export function addIntegrationIssue(input: AddIntegrationIssueInput): Issue {
  return addIssue(createIntegrationIssueInput(input));
}

export function listIntegrationIssues(
  input: ListIntegrationIssuesInput = {}
): Array<Issue> {
  return listIssues(createIntegrationIssueListInput(input));
}
