// Tipos de transferencia (DTO) que viajan del servidor a los componentes cliente del
// tablero. Serializables (sin objetos Date: las fechas viajan como ISO string).

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

export type CardDTO = {
  id: string;
  title: string;
  position: string;
  description: string | null;
  dueDate: string | null;
  labels: LabelDTO[];
  checklists: ChecklistDTO[];
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
