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
};

export type CommentDTO = {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
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
  lists: ListDTO[];
  labels: LabelDTO[];
};
