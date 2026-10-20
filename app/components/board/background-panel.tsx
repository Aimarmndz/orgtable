"use client";

import { useState } from "react";
import { BOARD_COLORS, BOARD_COLOR_KEYS, HEX_COLOR } from "@/app/lib/colors";
import {
  removeBoardBackgroundImage,
  setBoardBackground,
  setBoardBackgroundImage,
} from "@/app/lib/actions/boards";
import { ColorPicker } from "../ui/color-picker";
import { useI18n } from "@/app/i18n/client";

// "Change background", shared by the board menu and the right click on a board tile: the
// palette, automatic, any colour from the picker, or an uploaded image (shrunk to 2560 px
// in the browser). Owners only; setBoardBackground and setBoardBackgroundImage check it
// again. See docs/board-menu.md, "Background".

export function BackgroundPanel({
  boardId,
  background,
  hasImage,
  onPreview,
  onDone,
  onError,
}: {
  boardId: string;
  background: string | null;
  hasImage: boolean;
  /** The colour to show before the server confirms it (null = automatic). */
  onPreview?: (background: string | null) => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const { m } = useI18n();
  const t = m.boards.menu;
  const [custom, setCustom] = useState<string>(background && HEX_COLOR.test(background) ? background : "#3b6e8f");
  const [uploading, setUploading] = useState(false);

  async function save(next: string | null) {
    onPreview?.(next);
    try {
      if ((await setBoardBackground({ boardId, background: next })).ok) return onDone();
    } catch {
      // Reported below.
    }
    onError(t.failed);
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const blob = await shrinkImage(file, 2560);
      const data = new FormData();
      data.set("boardId", boardId);
      data.set("image", blob, blob.type === "image/webp" ? "background.webp" : "background.jpg");
      const result = await setBoardBackgroundImage(data);
      if (result.ok) return onDone();
      onError(result.error === "too_big" ? t.imageTooBig : result.error === "bad_image" ? t.imageInvalid : t.failed);
    } catch {
      // The browser could not decode it (HEIC on some browsers, a broken file…).
      onError(t.imageInvalid);
    } finally {
      setUploading(false);
    }
  }

  // A detached file field: opening the file picker blurs the window, which closes the menu
  // (and would unmount a field inside it before the choice arrives). This one outlives it,
  // and so does the upload; onDone/onError belong to the board or the app menu.
  function pickFile() {
    const field = document.createElement("input");
    field.type = "file";
    field.accept = "image/png,image/jpeg,image/webp,image/*";
    field.addEventListener("change", () => {
      const file = field.files?.[0];
      if (file) void upload(file);
    });
    field.click();
  }

  return (
    <div className="space-y-3 p-2">
      <div className="grid grid-cols-4 gap-2">
        {BOARD_COLOR_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            data-menu-item=""
            aria-pressed={background === key}
            aria-label={m.workspaces.rolesPage.colors[key] ?? key}
            title={m.workspaces.rolesPage.colors[key] ?? key}
            onClick={() => void save(key)}
            style={{ background: BOARD_COLORS[key] }}
            className={`h-10 rounded-[10px] outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink ${
              background === key ? "outline-2 outline-ink" : ""
            }`}
          />
        ))}
      </div>
      <button
        type="button"
        data-menu-item=""
        onClick={() => void save(null)}
        className="flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-sm font-medium hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
      >
        {t.backgroundAuto}
        <span className="text-xs text-ink-muted">{t.backgroundAutoHint}</span>
      </button>

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-semibold text-ink-muted">{m.common.colorPicker.custom}</p>
        <ColorPicker value={custom} onChange={(c) => HEX_COLOR.test(c) && setCustom(c)} />
        <button
          type="button"
          data-menu-item=""
          onClick={() => void save(custom)}
          className="h-9 w-full rounded-lg bg-accent text-sm font-semibold text-accent-ink hover:bg-accent-hover"
        >
          {t.applyColour}
        </button>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs font-semibold text-ink-muted">{t.image}</p>
        <button
          type="button"
          data-menu-item=""
          disabled={uploading}
          onClick={pickFile}
          className="h-9 w-full rounded-lg border border-border bg-surface text-sm font-semibold hover:bg-surface-2 disabled:opacity-60"
        >
          {uploading ? t.uploadingImage : hasImage ? t.changeImage : t.uploadImage}
        </button>
        {hasImage && (
          <button
            type="button"
            data-menu-item=""
            disabled={uploading}
            onClick={async () => {
              try {
                if ((await removeBoardBackgroundImage({ boardId })).ok) return onDone();
              } catch {
                // Reported below.
              }
              onError(t.failed);
            }}
            className="h-9 w-full rounded-lg text-sm font-semibold text-danger hover:bg-danger/10"
          >
            {t.removeImage}
          </button>
        )}
        <p className="text-xs text-ink-muted">{t.imageHint}</p>
      </div>
    </div>
  );
}

/** Fits the image inside `max` px (never enlarges) and encodes it as WebP, or JPEG. */
async function shrinkImage(file: File, max: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  // Safari before 17 returns PNG when asked for WebP: then JPEG, which is smaller.
  const webp = await encode("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg");
  if (!jpeg) throw new Error("Could not encode the image");
  return jpeg;
}
