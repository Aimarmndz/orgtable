// Data transfer types (DTOs) sent from the server to the board's Client Components.
// Serializable: no Date objects, dates travel as ISO strings.

export type LabelDTO = {
  id: string;
  name: string;
  color: string;
};

export type ChecklistItemDTO = {
  id: string;
  text: string;
  done: boolean;
};

export type ChecklistDTO = {
  id: string;
  title: string;
  items: ChecklistItemDTO[];
};

export type AttachmentDTO = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type AssigneeDTO = {
  id: string;
  name: string;
  avatarStoredName: string | null;
};

export type CommentDTO = {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  createdAt: string;
};

export type CardDTO = {
  id: string;
  title: string;
  position: string;
  description: string | null;
  dueDate: string | null;
  labels: LabelDTO[];
  checklists: ChecklistDTO[];
  attachments: AttachmentDTO[];
  assignees: AssigneeDTO[];
  comments: CommentDTO[];
};

export type ListDTO = {
  id: string;
  title: string;
  position: string;
  cards: CardDTO[];
};

export type BoardDTO = {
  id: string;
  title: string;
  background: string | null;
  // Uploaded image over the colour (boardImageUrl); the stored name is its cache key.
  backgroundImageStoredName: string | null;
  // Where it lives (/<workspace.slug>/…) and who besides its members sees it.
  workspace: { slug: string; name: string; kind: "PERSONAL" | "ORGANIZATION" };
  visibility: "WORKSPACE" | "PRIVATE";
  // The viewer may change `visibility`: they manage the board or hold "boards.visibility"
  // in its organization (app/lib/permissions.ts). The action checks it again.
  canChangeVisibility: boolean;
  // The viewer belongs to the board's organization, so its settings open for them (a guest
  // added only to the board would get a 404 there).
  inOrganization: boolean;
  lists: ListDTO[];
  labels: LabelDTO[];
};
