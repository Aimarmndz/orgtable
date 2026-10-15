import { BOARD_COLORS, pickBoardColor, type BoardColor } from "@/app/lib/colors";
import { initials } from "@/app/lib/initials";

// An organization's avatar: its logo if it has one, else its initials on its brand colour
// (or a stable colour from its id). No "use client": presentation only.

export function WorkspaceAvatar({
  workspace,
  size = 36,
}: {
  workspace: { id: string; slug: string; name: string; brandColor?: string | null; logoStoredName?: string | null };
  size?: number;
}) {
  const style = { width: size, height: size };
  if (workspace.logoStoredName) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- an authorized route, not a static asset.
      <img
        src={`/api/workspaces/${workspace.slug}/logo?v=${encodeURIComponent(workspace.logoStoredName)}`}
        alt=""
        style={style}
        className="shrink-0 rounded-lg bg-surface object-contain ring-1 ring-border"
      />
    );
  }
  const color =
    workspace.brandColor && workspace.brandColor in BOARD_COLORS
      ? BOARD_COLORS[workspace.brandColor as BoardColor]
      : BOARD_COLORS[pickBoardColor(workspace.id)];
  return (
    <span
      aria-hidden
      style={{ ...style, background: color, fontSize: Math.max(10, Math.round(size / 3)) }}
      className="grid shrink-0 place-items-center rounded-lg font-bold text-white"
    >
      {initials(workspace.name)}
    </span>
  );
}
