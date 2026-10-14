import "server-only";

// JSON serialization for the public API. Defines the stable shape clients see (dates as
// ISO strings, flattened labels). The input types describe only the fields that are read:
// Prisma results fit structurally even with extra fields. See docs/api/public-api.md.

type LabelRow = { id: string; name: string; color: string };

type CardRow = {
  id: string;
  title: string;
  description: string | null;
  position: string;
  dueDate: Date | null;
  labels: { label: LabelRow }[];
  checklists: {
    id: string;
    title: string;
    items: { id: string; text: string; done: boolean }[];
  }[];
  attachments: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
  }[];
  assignees: { user: { id: string; name: string } }[];
  comments: {
    id: string;
    text: string;
    authorId: string;
    createdAt: Date;
    author: { name: string };
  }[];
};

type ListRow = {
  id: string;
  title: string;
  position: string;
  cards: CardRow[];
};

type BoardRow = {
  id: string;
  title: string;
  background: string | null;
  createdAt: Date;
  updatedAt: Date;
  labels: LabelRow[];
  lists: ListRow[];
};

export function serializeBoardSummary(b: {
  id: string;
  title: string;
  background: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: b.id,
    title: b.title,
    background: b.background,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export function serializeCard(c: CardRow) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    position: c.position,
    dueDate: c.dueDate ? c.dueDate.toISOString() : null,
    labels: c.labels.map((l) => ({
      id: l.label.id,
      name: l.label.name,
      color: l.label.color,
    })),
    checklists: c.checklists.map((ch) => ({
      id: ch.id,
      title: ch.title,
      items: ch.items.map((it) => ({
        id: it.id,
        text: it.text,
        done: it.done,
      })),
    })),
    attachments: c.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
    })),
    assignees: c.assignees.map((a) => ({
      id: a.user.id,
      name: a.user.name,
    })),
    comments: c.comments.map((cm) => ({
      id: cm.id,
      text: cm.text,
      authorId: cm.authorId,
      authorName: cm.author.name,
      createdAt: cm.createdAt.toISOString(),
    })),
  };
}

export function serializeListSummary(l: {
  id: string;
  title: string;
  position: string;
}) {
  return { id: l.id, title: l.title, position: l.position };
}

export function serializeBoardFull(b: BoardRow) {
  return {
    id: b.id,
    title: b.title,
    background: b.background,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    labels: b.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    lists: b.lists.map((list) => ({
      id: list.id,
      title: list.title,
      position: list.position,
      cards: list.cards.map(serializeCard),
    })),
  };
}
