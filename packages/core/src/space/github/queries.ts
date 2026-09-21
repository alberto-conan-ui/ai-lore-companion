/**
 * The GraphQL documents the gh adapter sends. Each is a constant text; every
 * value that comes from outside travels as a variable, never inside the text.
 *
 * Field and input names were checked against GitHub's live schema by
 * introspection on 2026-09-18.
 */

const REPOSITORY_FIELDS = 'id nameWithOwner url isPrivate';
const PROJECT_FIELDS = 'id number title url';
const SINGLE_SELECT_FIELDS = 'id name options { id name color description }';
const VIEW_FIELDS = 'id number name layout filter';

/** A repository by owner and name. */
export const REPOSITORY_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { ${REPOSITORY_FIELDS} }
}`;

/** The node id of a user or an organisation. */
export const OWNER_QUERY = `query($login: String!) {
  repositoryOwner(login: $login) { id login }
}`;

/** Create a repository. */
export const CREATE_REPOSITORY_MUTATION = `mutation($input: CreateRepositoryInput!) {
  createRepository(input: $input) { repository { ${REPOSITORY_FIELDS} } }
}`;

/** One page of an owner's Projects, oldest first. The list is read, not searched, so a new Project is in it. */
export const OWNER_PROJECTS_QUERY = `query($login: String!, $after: String) {
  repositoryOwner(login: $login) {
    id
    login
    ... on ProjectV2Owner {
      projectsV2(first: 100, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
        pageInfo { hasNextPage endCursor }
        nodes { ${PROJECT_FIELDS} closed }
      }
    }
  }
}`;

/** Create a Project. */
export const CREATE_PROJECT_MUTATION = `mutation($input: CreateProjectV2Input!) {
  createProjectV2(input: $input) { projectV2 { ${PROJECT_FIELDS} } }
}`;

/** A field of a Project by name. */
export const PROJECT_FIELD_QUERY = `query($project: ID!, $name: String!) {
  node(id: $project) {
    ... on ProjectV2 {
      field(name: $name) {
        __typename
        ... on ProjectV2SingleSelectField { ${SINGLE_SELECT_FIELDS} }
      }
    }
  }
}`;

/** Create a single-select field. */
export const CREATE_FIELD_MUTATION = `mutation($input: CreateProjectV2FieldInput!) {
  createProjectV2Field(input: $input) {
    projectV2Field { ... on ProjectV2SingleSelectField { ${SINGLE_SELECT_FIELDS} } }
  }
}`;

/** Replace a single-select field's options. Existing options are sent with their ids so that item values are kept. */
export const UPDATE_FIELD_MUTATION = `mutation($input: UpdateProjectV2FieldInput!) {
  updateProjectV2Field(input: $input) {
    projectV2Field { ... on ProjectV2SingleSelectField { ${SINGLE_SELECT_FIELDS} } }
  }
}`;

/** The views of a Project. */
export const PROJECT_VIEWS_QUERY = `query($project: ID!) {
  node(id: $project) {
    ... on ProjectV2 { views(first: 50) { nodes { ${VIEW_FIELDS} } } }
  }
}`;

/** Create a view. */
export const CREATE_VIEW_MUTATION = `mutation($input: CreateProjectV2ViewInput!) {
  createProjectV2View(input: $input) { projectV2View { ${VIEW_FIELDS} } }
}`;

/** Update a view; used to set its filter, which creation does not take. */
export const UPDATE_VIEW_MUTATION = `mutation($input: UpdateProjectV2ViewInput!) {
  updateProjectV2View(input: $input) { projectV2View { ${VIEW_FIELDS} } }
}`;

/** A repository's id and the repositories a Project is already linked to. */
export const PROJECT_LINK_QUERY = `query($owner: String!, $name: String!, $project: ID!) {
  repository(owner: $owner, name: $name) { id }
  node(id: $project) {
    ... on ProjectV2 { repositories(first: 100) { nodes { id } } }
  }
}`;

/** Link a Project to a repository. */
export const LINK_PROJECT_MUTATION = `mutation($input: LinkProjectV2ToRepositoryInput!) {
  linkProjectV2ToRepository(input: $input) { repository { id } }
}`;

/** The commits of a repository's branches, at most 100. */
export const BRANCH_HEADS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: 100) { nodes { target { oid } } }
  }
}`;

/** An owner's repositories, newest push first, each with its Space manifest when it has one. */
export const OWNER_SPACE_REPOSITORIES_QUERY = `query($login: String!) {
  repositoryOwner(login: $login) {
    repositories(first: 100, orderBy: { field: PUSHED_AT, direction: DESC }) {
      nodes { ${REPOSITORY_FIELDS} manifest: object(expression: "HEAD:lore/space.md") { id } }
    }
  }
}`;

/** One page of a repository's issues with their bodies, oldest first. */
export const ISSUE_BODIES_QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $after, states: [OPEN, CLOSED], orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes { number url body }
    }
  }
}`;

/** A repository's id and the ids of `count` labels, given as the variables `$l0`, `$l1` and so on. */
export function repositoryAndLabelsQuery(count: number): string {
  const indexes = Array.from({ length: count }, (_, index) => index);
  const variables = indexes.map((index) => `, $l${index}: String!`).join('');
  const labels = indexes.map((index) => `l${index}: label(name: $l${index}) { id }`).join(' ');
  return `query($owner: String!, $name: String!${variables}) {
  repository(owner: $owner, name: $name) { id ${labels} }
}`;
}

/** Create an issue. */
export const CREATE_ISSUE_MUTATION = `mutation($input: CreateIssueInput!) {
  createIssue(input: $input) { issue { number url } }
}`;

/** An issue's node id, state and parent. */
export const ISSUE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) { id state parent { id } }
  }
}`;

/** The node ids of a parent and a child, and the child's present parent. */
export const ISSUE_PAIR_QUERY = `query($parentOwner: String!, $parentName: String!, $parentNumber: Int!, $childOwner: String!, $childName: String!, $childNumber: Int!) {
  parent: repository(owner: $parentOwner, name: $parentName) {
    issue(number: $parentNumber) { id }
  }
  child: repository(owner: $childOwner, name: $childName) {
    issue(number: $childNumber) { id parent { id } }
  }
}`;

/** Update an issue's title or body. */
export const UPDATE_ISSUE_MUTATION = `mutation($input: UpdateIssueInput!) {
  updateIssue(input: $input) { issue { id } }
}`;

/** Make an issue a sub-issue of another. */
export const ADD_SUB_ISSUE_MUTATION = `mutation($input: AddSubIssueInput!) {
  addSubIssue(input: $input) { subIssue { id } }
}`;

/** Put an issue on a Project. GitHub answers with the existing item when it is already there. */
export const ADD_ITEM_MUTATION = `mutation($input: AddProjectV2ItemByIdInput!) {
  addProjectV2ItemById(input: $input) { item { id } }
}`;

/** Set a field of a Project item. */
export const SET_FIELD_VALUE_MUTATION = `mutation($input: UpdateProjectV2ItemFieldValueInput!) {
  updateProjectV2ItemFieldValue(input: $input) { projectV2Item { id } }
}`;

/** Add a comment. */
export const ADD_COMMENT_MUTATION = `mutation($input: AddCommentInput!) {
  addComment(input: $input) { clientMutationId }
}`;

/** Close an issue. */
export const CLOSE_ISSUE_MUTATION = `mutation($input: CloseIssueInput!) {
  closeIssue(input: $input) { issue { id } }
}`;

/**
 * One page of 100 of a Project's items, with each issue's single-select values
 * and sub-issues in the same query (section 5.3, budget). Labels and Status of
 * a sub-issue are not asked for here; see `RawProjectIssue`.
 */
export const READ_PROJECT_QUERY = `query($project: ID!, $stage: String!, $after: String) {
  node(id: $project) {
    ... on ProjectV2 {
      stage: field(name: $stage) {
        ... on ProjectV2SingleSelectField { id name options { id name } }
      }
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isArchived
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                updatedAt
                field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
          content {
            __typename
            ... on Issue {
              number url title body state updatedAt
              repository { nameWithOwner }
              labels(first: 20) { nodes { name } }
              parent { number repository { nameWithOwner } }
              subIssues(first: 50) {
                nodes { number url title state repository { nameWithOwner } }
              }
            }
          }
        }
      }
    }
  }
}`;
