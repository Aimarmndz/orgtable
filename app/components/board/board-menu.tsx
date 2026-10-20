"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { BoardDTO, CardDTO, ListDTO } from "@/app/lib/types";
import type { BoardMemberDTO } from "./members-panel";
import {
  BOARD_COLORS,
  BOARD_COLOR_KEYS,
  labelBackground,
  type BoardColor,
} from "@/app/lib/colors";
import {
  dueShortcuts,
  edgeKey,
  neighbourKey,
  type Point,
} from "@/app/lib/board-menu";
import { renameBoard, setBoardBackground } from "@/app/lib/actions/boards";
import {
  deleteList,
  moveAllCardsTo,
  renameList,
  reorderList,
  sortListByDue,
} from "@/app/lib/actions/lists";
import {
  deleteCard,
  duplicateCard,
  moveCard,
  renameCard,
  setCardDueDate,
} from "@/app/lib/actions/cards";
import { toggleCardLabel } from "@/app/lib/actions/labels";
import { LabelManager } from "../card/label-editor";
import { assignMember, unassignMember } from "@/app/lib/actions/assignees";
import {
  ContextMenu,
  type MenuEntry,
  type MenuItem,
  type MenuPanel,
} from "./context-menu";
import { useI18n } from "@/app/i18n/client";
import { fmt, plural } from "@/app/i18n/format";

// What a right click (or a long press, or the context-menu key) offers inside a board:
// the board itself on the background, a list on its column, a card on the card. Only
// what the viewer's role allows is listed; every action checks it again on the server.
// The menu is drawn by ContextMenu. See docs/board-menu.md.

export type MenuTarget =
  | { kind: "board" }
  | { kind: "list"; listId: string }
  | { kind: "card"; cardId: string };
export type BoardMenuState = {
  target: MenuTarget;
  at: Point;
  mode: "popover" | "sheet";
};

type Result = { ok: boolean } | void;

export function BoardMenu({
  state,
  board,
  lists,
  members,
  currentUserId,
  view,
  canEdit,
  canManage,
  onClose,
  onOpenCard,
  onSetView,
  onOpenMembers,
  onOpenFilters,
  onBackground,
  onNotice,
}: {
  state: BoardMenuState;
  board: BoardDTO;
  lists: ListDTO[];
  members: BoardMemberDTO[];
  currentUserId: string;
  view: "board" | "calendar";
  canEdit: boolean;
  canManage: boolean;
  onClose: () => void;
  onOpenCard: (cardId: string) => void;
  onSetView: (view: "board" | "calendar") => void;
  onOpenMembers: () => void;
  onOpenFilters: () => void;
  onBackground: (background: string | null) => void;
  onNotice: (message: string) => void;
}) {
  const { m, intl } = useI18n();
  const t = m.boards.menu;
  const router = useRouter();
  // Inline "Delete? No / Delete" in place of the delete item.
  const [confirming, setConfirming] = useState(false);

  async function run(action: () => Promise<Result>, success?: string) {
    try {
      const result = await action();
      if (result && !result.ok) return onNotice(t.failed);
      if (success) onNotice(success);
    } catch {
      onNotice(t.failed);
    }
  }
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };

  async function copyLink(path: string) {
    try {
      await navigator.clipboard.writeText(
        new URL(path, location.origin).toString(),
      );
      onNotice(t.linkCopied);
    } catch {
      onNotice(t.copyFailed);
    }
  }
  const boardUrl = () => location.pathname;

  // Focus the "add" field of the board (lists) or of a list (cards), switching back to
  // the board view first when the calendar is showing.
  function focusField(selector: string) {
    if (view !== "board") onSetView("board");
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(selector);
      input?.scrollIntoView({ block: "nearest", inline: "nearest" });
      input?.focus();
    }, 0);
  }

  const sep = (id: string): MenuEntry => ({ kind: "separator", id });
  const renamePanel = (
    id: string,
    title: string,
    field: string,
    initial: string,
    maxLength: number,
    save: (value: string) => void,
  ): MenuPanel => ({
    id,
    title,
    width: 280,
    entries: [
      {
        kind: "custom",
        id: `${id}-form`,
        render: ({ close }) => (
          <RenameForm
            label={field}
            initial={initial}
            maxLength={maxLength}
            saveLabel={t.save}
            onSave={(value) => {
              close();
              if (value !== initial) save(value);
            }}
          />
        ),
      },
    ],
  });

  // --- Board (background, header, empty column space) ---
  function boardPanel(): MenuPanel {
    const entries: MenuEntry[] = [];
    if (canEdit)
      entries.push({
        kind: "item",
        id: "add-list",
        label: t.addList,
        icon: icons.plus,
        accel: "l",
        accelLabel: "L",
        onSelect: () => focusField("[data-add-list] input[name=title]"),
      });
    if (canManage) {
      entries.push({
        kind: "item",
        id: "background",
        label: t.background,
        icon: icons.palette,
        submenu: {
          id: "background",
          title: t.backgroundHeading,
          width: 252,
          entries: [
            {
              kind: "custom",
              id: "swatches",
              render: () => (
                <Swatches
                  current={board.background}
                  names={m.workspaces.rolesPage.colors}
                  onPick={(color) => {
                    onBackground(color);
                    void run(() =>
                      setBoardBackground({
                        boardId: board.id,
                        background: color,
                      }),
                    );
                  }}
                />
              ),
            },
            sep("bg-sep"),
            {
              kind: "item",
              id: "bg-auto",
              role: "menuitemradio",
              checked:
                !board.background ||
                !Object.hasOwn(BOARD_COLORS, board.background),
              label: t.backgroundAuto,
              hint: t.backgroundAutoHint,
              icon: icons.refresh,
              keepOpen: true,
              onSelect: () => {
                onBackground(null);
                void run(() =>
                  setBoardBackground({ boardId: board.id, background: null }),
                );
              },
            },
            {
              kind: "custom",
              id: "bg-note",
              render: () => (
                <p className="px-2.5 pb-2 pt-1 text-xs text-ink-muted">
                  {t.backgroundNote}
                </p>
              ),
            },
          ],
        },
      });
      entries.push({
        kind: "item",
        id: "manage-labels",
        label: t.manageLabels,
        icon: icons.tag,
        hint: board.labels.length ? String(board.labels.length) : undefined,
        submenu: {
          id: "manage-labels",
          title: t.labelsHeading,
          width: 320,
          entries: [
            {
              kind: "custom",
              id: "label-manager",
              render: () => <LabelManager boardId={board.id} labels={board.labels} />,
            },
          ],
        },
      });
      entries.push({
        kind: "item",
        id: "rename-board",
        label: t.renameBoard,
        icon: icons.pencil,
        submenu: renamePanel(
          "rename-board",
          t.renameBoard,
          t.boardName,
          board.title,
          120,
          (title) =>
            void run(async () => {
              const result = await renameBoard({ boardId: board.id, title });
              if (result.ok && result.path) router.replace(result.path);
              return result;
            }),
        ),
      });
    }
    if (entries.length) entries.push(sep("board-sep-1"));
    entries.push(
      view === "board"
        ? {
            kind: "item",
            id: "calendar",
            label: t.viewCalendar,
            icon: icons.calendar,
            accel: "c",
            accelLabel: "C",
            onSelect: () => onSetView("calendar"),
          }
        : {
            kind: "item",
            id: "calendar",
            label: t.viewBoard,
            icon: icons.columns,
            accel: "c",
            accelLabel: "C",
            onSelect: () => onSetView("board"),
          },
    );
    if (view === "board")
      entries.push({
        kind: "item",
        id: "filter",
        label: t.filter,
        icon: icons.filter,
        accel: "f",
        accelLabel: "F",
        onSelect: onOpenFilters,
      });
    entries.push({
      kind: "item",
      id: "members",
      label: t.members,
      icon: icons.people,
      onSelect: onOpenMembers,
    });
    entries.push(sep("board-sep-2"));
    entries.push({
      kind: "item",
      id: "copy-board",
      label: t.copyLink,
      icon: icons.link,
      onSelect: () => void copyLink(boardUrl()),
    });
    entries.push({
      kind: "item",
      id: "export",
      label: t.exportJson,
      icon: icons.download,
      onSelect: () => downloadFrom(`/api/boards/${board.id}/export`),
    });
    if (board.inOrganization) {
      entries.push({
        kind: "item",
        id: "org-settings",
        label: t.orgSettings,
        icon: icons.sliders,
        onSelect: () => router.push(`/${board.workspace.slug}/settings`),
      });
    }
    return { id: "board", title: t.boardHeading, entries };
  }

  // --- List ---
  function listPanel(list: ListDTO): MenuPanel {
    const index = lists.findIndex((l) => l.id === list.id);
    const positions = lists.map((l) => l.position);
    const move = (direction: -1 | 1) => {
      const position = neighbourKey(positions, index, direction);
      if (position) void run(() => reorderList({ listId: list.id, position }));
    };
    const others = lists.filter((l) => l.id !== list.id);
    const entries: MenuEntry[] = [
      {
        kind: "item",
        id: "add-card",
        label: t.addCard,
        icon: icons.plus,
        accel: "n",
        accelLabel: "N",
        onSelect: () =>
          focusField(`[data-add-card="${list.id}"] input[name=title]`),
      },
      {
        kind: "item",
        id: "rename-list",
        label: t.renameList,
        icon: icons.pencil,
        accel: "r",
        accelLabel: "R",
        submenu: renamePanel(
          "rename-list",
          t.renameList,
          t.listName,
          list.title,
          120,
          (title) =>
            void run(() => renameList(form({ listId: list.id, title }))),
        ),
      },
      sep("list-sep-1"),
      {
        kind: "item",
        id: "left",
        label: t.moveLeft,
        icon: icons.left,
        disabled: index <= 0,
        onSelect: () => move(-1),
      },
      {
        kind: "item",
        id: "right",
        label: t.moveRight,
        icon: icons.right,
        disabled: index >= lists.length - 1,
        onSelect: () => move(1),
      },
      {
        kind: "item",
        id: "sort",
        label: t.sortByDue,
        icon: icons.sort,
        disabled: list.cards.length < 2,
        onSelect: () =>
          void run(() => sortListByDue({ listId: list.id }), t.sorted),
      },
      sep("list-sep-2"),
      {
        kind: "item",
        id: "move-all",
        label: t.moveAllTo,
        icon: icons.right,
        disabled: list.cards.length === 0 || others.length === 0,
        submenu: {
          id: "move-all",
          title: t.moveAllTo,
          entries: others.map((o) => ({
            kind: "item" as const,
            id: `to-${o.id}`,
            label: o.title,
            onSelect: () =>
              void run(async () => {
                const result = await moveAllCardsTo({
                  fromListId: list.id,
                  toListId: o.id,
                });
                if (result.ok)
                  onNotice(
                    plural(intl, t.movedAll, result.moved ?? 0, {
                      list: o.title,
                    }),
                  );
                return result;
              }),
          })),
        },
      },
      sep("list-sep-3"),
    ];
    if (confirming) {
      entries.push({
        kind: "custom",
        id: "confirm-list",
        render: () => (
          <div className="px-1 pb-1">
            <p className="px-1.5 pb-1 pt-1.5 text-[13.5px] leading-snug">
              {list.cards.length === 0
                ? t.deleteListEmpty
                : plural(intl, t.deleteListWarning, list.cards.length)}
            </p>
            <div className="flex gap-1.5 pt-1.5">
              <button
                type="button"
                data-menu-item=""
                autoFocus
                onClick={() => setConfirming(false)}
                className="h-9 flex-1 rounded-lg border border-border text-[13px] font-semibold hover:bg-surface-2"
              >
                {t.keepList}
              </button>
              <button
                type="button"
                data-menu-item=""
                onClick={() => {
                  onClose();
                  void run(() => deleteList(form({ listId: list.id })));
                }}
                className="h-9 flex-1 rounded-lg bg-danger text-[13px] font-semibold text-white hover:opacity-90"
              >
                {t.confirmDeleteList}
              </button>
            </div>
          </div>
        ),
      });
    } else {
      entries.push({
        kind: "item",
        id: "delete-list",
        label: t.deleteList,
        icon: icons.trash,
        danger: true,
        keepOpen: true,
        onSelect: () => setConfirming(true),
      });
    }
    return {
      id: "list",
      title: fmt(t.listHeading, { title: list.title }),
      entries,
    };
  }

  // --- Card ---
  function cardItems(
    card: CardDTO,
    list: ListDTO,
  ): { panel: MenuPanel; quick: MenuItem[] } {
    const cardPath = `${boardUrl()}?card=${encodeURIComponent(card.id)}`;
    const open: MenuItem = {
      kind: "item",
      id: "open",
      label: t.openCard,
      shortLabel: t.quickOpen,
      icon: icons.open,
      accel: "Enter",
      accelLabel: "↵",
      onSelect: () => onOpenCard(card.id),
    };
    const link: MenuItem = {
      kind: "item",
      id: "copy-card",
      label: t.copyLink,
      shortLabel: t.quickLink,
      icon: icons.link,
      onSelect: () => void copyLink(cardPath),
    };
    if (!canEdit)
      return {
        panel: { id: "card", title: card.title, entries: [open, link] },
        quick: [],
      };

    const due = dueShortcuts(new Date());
    const currentDue = card.dueDate?.slice(0, 10) ?? null;
    const others = list.cards
      .filter((c) => c.id !== card.id)
      .map((c) => c.position);
    const toList = (target: ListDTO) => {
      const position = edgeKey(
        target.cards.map((c) => c.position),
        "bottom",
      );
      void run(() =>
        moveCard({ cardId: card.id, toListId: target.id, position }),
      );
    };
    const assigned = new Set(card.assignees.map((a) => a.id));
    const people = [...members].sort(
      (a, b) => Number(b.id === currentUserId) - Number(a.id === currentUserId),
    );
    const setDue = (day: string | null) =>
      void run(() => setCardDueDate({ cardId: card.id, dueDate: day }));
    const shortDay = (day: string) =>
      new Intl.DateTimeFormat(intl, {
        weekday: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(day));

    const move: MenuItem = {
      kind: "item",
      id: "move",
      label: t.moveTo,
      shortLabel: t.quickMove,
      icon: icons.right,
      submenu: {
        id: "move",
        title: t.moveTo,
        entries: [
          ...lists.map((l) => ({
            kind: "item" as const,
            id: `move-${l.id}`,
            label: l.title,
            hint: l.id === list.id ? t.currentList : undefined,
            disabled: l.id === list.id,
            onSelect: () => toList(l),
          })),
          sep("move-sep"),
          {
            kind: "item",
            id: "top",
            label: t.toTop,
            icon: icons.up,
            disabled: list.cards[0]?.id === card.id,
            onSelect: () =>
              void run(() =>
                moveCard({
                  cardId: card.id,
                  toListId: list.id,
                  position: edgeKey(others, "top"),
                }),
              ),
          },
          {
            kind: "item",
            id: "bottom",
            label: t.toBottom,
            icon: icons.down,
            disabled: list.cards[list.cards.length - 1]?.id === card.id,
            onSelect: () =>
              void run(() =>
                moveCard({
                  cardId: card.id,
                  toListId: list.id,
                  position: edgeKey(others, "bottom"),
                }),
              ),
          },
        ],
      },
    };
    const duplicate: MenuItem = {
      kind: "item",
      id: "duplicate",
      label: t.duplicate,
      icon: icons.copy,
      accel: "d",
      accelLabel: "D",
      onSelect: () =>
        void run(() => duplicateCard({ cardId: card.id }), t.duplicated),
    };

    const entries: MenuEntry[] = [
      open,
      {
        kind: "item",
        id: "rename-card",
        label: t.renameCard,
        icon: icons.pencil,
        accel: "r",
        accelLabel: "R",
        submenu: renamePanel(
          "rename-card",
          t.renameCard,
          t.cardName,
          card.title,
          500,
          (title) =>
            void run(() => renameCard(form({ cardId: card.id, title }))),
        ),
      },
      sep("card-sep-1"),
      {
        kind: "item",
        id: "labels",
        label: t.labels,
        icon: icons.tag,
        hint: card.labels.length ? String(card.labels.length) : undefined,
        submenu: {
          id: "labels",
          title: t.labels,
          entries: [
            ...board.labels.map((l) => ({
              kind: "item" as const,
              id: `label-${l.id}`,
              role: "menuitemcheckbox" as const,
              checked: card.labels.some((x) => x.id === l.id),
              label: l.name,
              icon: (
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: labelBackground(l.color) }}
                />
              ),
              keepOpen: true,
              onSelect: () =>
                void run(() =>
                  toggleCardLabel({ cardId: card.id, labelId: l.id }),
                ),
            })),
            ...(board.labels.length ? [sep("labels-sep")] : []),
            {
              kind: "item",
              id: "new-label",
              label: t.newLabel,
              icon: icons.plus,
              onSelect: () => onOpenCard(card.id),
            },
          ],
        },
      },
      {
        kind: "item",
        id: "due",
        label: t.due,
        icon: icons.clock,
        hint: currentDue ? shortDay(currentDue) : undefined,
        submenu: {
          id: "due",
          title: t.due,
          entries: [
            ...(
              [
                ["today", t.dueToday, due.today],
                ["tomorrow", t.dueTomorrow, due.tomorrow],
                ["monday", t.dueNextMonday, due.nextMonday],
                ["week", t.dueInAWeek, due.inAWeek],
              ] as const
            ).map(([id, label, day]) => ({
              kind: "item" as const,
              id: `due-${id}`,
              role: "menuitemradio" as const,
              checked: currentDue === day,
              label,
              hint: shortDay(day),
              onSelect: () => setDue(day),
            })),
            sep("due-sep"),
            {
              kind: "custom",
              id: "due-pick",
              render: ({ close }) => (
                <DateForm
                  label={t.dateField}
                  initial={currentDue ?? ""}
                  saveLabel={t.save}
                  onSave={(day) => {
                    close();
                    setDue(day || null);
                  }}
                />
              ),
            },
            ...(currentDue
              ? [
                  {
                    kind: "item" as const,
                    id: "due-clear",
                    label: t.clearDue,
                    icon: icons.x,
                    danger: true,
                    onSelect: () => setDue(null),
                  },
                ]
              : []),
          ],
        },
      },
      {
        kind: "item",
        id: "assign",
        label: t.assign,
        icon: icons.personPlus,
        hint: card.assignees.length ? String(card.assignees.length) : undefined,
        submenu: {
          id: "assign",
          title: t.assign,
          entries: people.map((p) => ({
            kind: "item" as const,
            id: `person-${p.id}`,
            role: "menuitemcheckbox" as const,
            checked: assigned.has(p.id),
            label:
              p.id === currentUserId ? fmt(t.you, { name: p.name }) : p.name,
            icon: (
              <span className="grid size-5 place-items-center rounded-full bg-surface-2 text-[10px] font-bold uppercase">
                {p.name.charAt(0)}
              </span>
            ),
            keepOpen: true,
            onSelect: () =>
              void run(() =>
                (assigned.has(p.id) ? unassignMember : assignMember)(
                  form({ cardId: card.id, userId: p.id }),
                ),
              ),
          })),
        },
      },
      move,
      sep("card-sep-2"),
      duplicate,
      link,
      sep("card-sep-3"),
    ];
    if (confirming) {
      entries.push({
        kind: "custom",
        id: "confirm-card",
        render: () => (
          <div className="flex items-center gap-1.5 py-1 pl-2.5 pr-1 text-[13.5px]">
            <span className="flex-1">{t.deleteCardPrompt}</span>
            <button
              type="button"
              data-menu-item=""
              autoFocus
              onClick={() => setConfirming(false)}
              className="h-8 rounded-lg border border-border px-2.5 text-[13px] font-semibold hover:bg-surface-2"
            >
              {t.no}
            </button>
            <button
              type="button"
              data-menu-item=""
              onClick={() => {
                onClose();
                void run(() => deleteCard(form({ cardId: card.id })));
              }}
              className="h-8 rounded-lg bg-danger px-2.5 text-[13px] font-semibold text-white hover:opacity-90"
            >
              {t.confirmDelete}
            </button>
          </div>
        ),
      });
    } else {
      entries.push({
        kind: "item",
        id: "delete-card",
        label: t.deleteCard,
        icon: icons.trash,
        danger: true,
        keepOpen: true,
        accel: "Delete",
        accelLabel: m.boards.menu.deleteKey,
        onSelect: () => setConfirming(true),
      });
    }
    const mobileEntries = entries.filter(
      (e) => !["open", "move", "duplicate", "copy-card"].includes(e.id),
    );
    return {
      panel: {
        id: "card",
        title: card.title,
        entries: state.mode === "sheet" ? mobileEntries : entries,
      },
      quick: [open, move, duplicate, link],
    };
  }

  let panel: MenuPanel;
  let quick: MenuItem[] | undefined;
  let subtitle: string | undefined;
  const target = state.target;
  const list =
    target.kind === "list"
      ? lists.find((l) => l.id === target.listId)
      : target.kind === "card"
        ? lists.find((l) => l.cards.some((c) => c.id === target.cardId))
        : undefined;
  const card =
    target.kind === "card"
      ? list?.cards.find((c) => c.id === target.cardId)
      : undefined;
  if (card && list) {
    ({ panel, quick } = cardItems(card, list));
    subtitle = fmt(t.sheetHint, { list: list.title });
    if (state.mode === "sheet" && !quick.length) quick = undefined;
  } else if (list && canEdit) {
    panel = listPanel(list);
  } else {
    // The board's menu: on the background, and on a list for someone who cannot edit it.
    panel = boardPanel();
  }

  return (
    <ContextMenu
      panel={panel}
      quick={state.mode === "sheet" ? quick : undefined}
      subtitle={subtitle}
      at={state.at}
      mode={state.mode}
      label={panel.title}
      closeLabel={t.close}
      backLabel={t.back}
      onClose={onClose}
    />
  );
}

function Swatches({
  current,
  names,
  onPick,
}: {
  current: string | null;
  names: Record<string, string>;
  onPick: (color: BoardColor) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2 px-2 pb-2 pt-1">
      {BOARD_COLOR_KEYS.map((key) => {
        const selected = current === key;
        return (
          <button
            key={key}
            type="button"
            data-menu-item=""
            role="menuitemradio"
            aria-checked={selected}
            aria-label={names[key] ?? key}
            title={names[key] ?? key}
            onClick={() => onPick(key)}
            style={{ background: BOARD_COLORS[key] }}
            className={`grid h-11 place-items-center rounded-[10px] text-white outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink ${selected ? "outline-2 outline-ink" : ""}`}
          >
            {selected && (
              <svg
                className="size-[18px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12l5 5 9-10" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}

function RenameForm({
  label,
  initial,
  maxLength,
  saveLabel,
  onSave,
}: {
  label: string;
  initial: string;
  maxLength: number;
  saveLabel: string;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex flex-col gap-2 p-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed) onSave(trimmed);
      }}
    >
      <label className="text-xs font-semibold text-ink-muted">
        {label}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={maxLength}
          required
          onFocus={(e) => e.currentTarget.select()}
          className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-2.5 text-sm font-medium text-ink outline-none focus:ring-2 focus:ring-accent/30"
        />
      </label>
      <button
        type="submit"
        className="h-9 rounded-lg bg-accent text-sm font-semibold text-accent-ink hover:bg-accent-hover"
      >
        {saveLabel}
      </button>
    </form>
  );
}

function DateForm({
  label,
  initial,
  saveLabel,
  onSave,
}: {
  label: string;
  initial: string;
  saveLabel: string;
  onSave: (day: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex items-end gap-1.5 p-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <label className="min-w-0 flex-1 text-xs font-semibold text-ink-muted">
        {label}
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/30"
        />
      </label>
      <button
        type="submit"
        className="h-9 shrink-0 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
      >
        {saveLabel}
      </button>
    </form>
  );
}

/** Starts a download (the route answers with Content-Disposition: attachment). */
function downloadFrom(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  a.click();
}

function icon(d: string): ReactNode {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
const icons = {
  plus: icon("M12 5v14M5 12h14"),
  palette: icon(
    "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.2-1-1.4-1-2.4 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.1-4-7.5-9-7.5zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01",
  ),
  pencil: icon("M4 20h4L19 9l-4-4L4 16z"),
  calendar: icon(
    "M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 2v4M16 2v4M3 10h18",
  ),
  columns: icon("M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z"),
  filter: icon("M3 5h18l-7 8v6l-4-2v-4z"),
  people: icon(
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.7 3.1 2.4 3.5 5.2",
  ),
  link: icon(
    "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  ),
  download: icon("M12 4v11M7 10l5 5 5-5M5 20h14"),
  sliders: icon("M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4"),
  refresh: icon(
    "M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5M18 3v4h-4M6 21v-4h4",
  ),
  left: icon("M19 12H5M11 6l-6 6 6 6"),
  right: icon("M5 12h14M13 6l6 6-6 6"),
  up: icon("M12 19V5M6 11l6-6 6 6"),
  down: icon("M12 5v14M6 13l6 6 6-6"),
  sort: icon("M7 4v16M3 16l4 4 4-4M14 6h7M14 12h5M14 18h3"),
  trash: icon("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"),
  open: icon(
    "M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  ),
  copy: icon(
    "M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2",
  ),
  tag: icon("M4 12V4h8l8 8-8 8zM8.5 8.5h.01"),
  clock: icon("M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"),
  personPlus: icon(
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c1-4 4-6 7-6s6 2 7 6M19 8v6M16 11h6",
  ),
  x: icon("M6 6l12 12M18 6L6 18"),
};
