"use client";

import { UserRound } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  centredCrop,
  clampCrop,
  cropSource,
  MAX_ZOOM,
  PHOTO_HEIGHT,
  PHOTO_MAX_LENGTH,
  PHOTO_WIDTH,
  zoomCrop,
  type Crop,
  type ProfilePhoto,
  type Size,
} from "@/lib/photo";

import { removePhoto, savePhoto, setPhotoOnResumes } from "./actions";

/** The crop frame on screen, 3:4 like the stored photo. */
const FRAME: Size = { width: 240, height: 320 };
/** How far an arrow key moves the photo, in screen pixels (with Shift, four times as far). */
const STEP = 8;

/**
 * The profile photo (#224) in Basics: add one, crop it, change or remove it,
 * and whether resumes show it. Each theme draws it in its own shape and place.
 */
export function PhotoField({ photo, onChange }: { photo: ProfilePhoto | null; onChange: (photo: ProfilePhoto | null) => void }) {
  const track = useTrackSave();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<HTMLImageElement | null>(null);

  async function pick(file: File) {
    const image = new Image();
    image.src = URL.createObjectURL(file);
    try {
      await image.decode();
      setPicked(image);
    } catch {
      URL.revokeObjectURL(image.src);
      toast("That file isn't a photo this browser can open. Try a JPEG or PNG.");
    }
  }

  function closeCrop() {
    if (picked) URL.revokeObjectURL(picked.src);
    setPicked(null);
  }

  async function use(src: string) {
    const next = { src, onResumes: photo?.onResumes ?? true };
    const result = await track(savePhoto(next));
    if (!result.ok) return toast(result.error);
    onChange(next);
    closeCrop();
  }

  async function remove() {
    if (!photo) return;
    const before = photo;
    onChange(null);
    const result = await track(removePhoto({}));
    if (!result.ok) {
      onChange(before);
      return toast(result.error);
    }
    toast("Removed your photo.", {
      action: {
        label: "Undo",
        onClick: async () => {
          const restored = await track(savePhoto(before));
          if (!restored.ok) return toast(restored.error);
          onChange(before);
          toast("Put your photo back.");
        },
      },
    });
  }

  async function showOnResumes(onResumes: boolean) {
    if (!photo) return;
    onChange({ ...photo, onResumes });
    const result = await track(setPhotoOnResumes({ onResumes }));
    if (!result.ok) {
      onChange(photo);
      toast(result.error);
    }
  }

  return (
    <div className="col-span-2 flex items-start gap-5">
      <div className="flex h-24 w-[72px] flex-none items-center justify-center overflow-hidden rounded-control border border-line-field bg-paper text-faint">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL: there's nothing for next/image to optimise.
          <img src={photo.src} alt="Your photo" className="size-full object-cover" />
        ) : (
          <UserRound aria-hidden size={32} strokeWidth={1.5} />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-label font-medium text-ink">
          Photo <span className="font-normal text-muted">(optional)</span>
        </p>
        <p className="text-label text-muted">
          For resumes: each theme shows it in its own shape and place. It stays on this server and is never sent to the AI.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
            {photo ? "Change photo" : "Add a photo"}
          </Button>
          {photo && (
            <Button variant="danger-text" size="sm" onClick={() => void remove()}>
              Remove
            </Button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Photo file"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Picking the same file again should open the crop again.
              event.target.value = "";
              if (file) void pick(file);
            }}
          />
        </div>
        {photo && (
          <Checkbox
            label="Show on resumes"
            hint="Each application can still leave it out, or put it on, from its Resume tab."
            checked={photo.onResumes}
            onChange={(event) => void showOnResumes(event.target.checked)}
          />
        )}
      </div>
      {picked && <CropDialog image={picked} onCancel={closeCrop} onUse={use} />}
    </div>
  );
}

/**
 * Crops the picked image to 3:4: drag it, or use the arrow keys, to move it,
 * and the slider, or + and −, to zoom. The circle shows what round and
 * square themes keep.
 */
function CropDialog({ image, onCancel, onUse }: { image: HTMLImageElement; onCancel: () => void; onUse: (src: string) => Promise<void> }) {
  const size: Size = { width: image.naturalWidth, height: image.naturalHeight };
  const [crop, setCrop] = useState<Crop>(() => centredCrop(size, FRAME));
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ pointer: number; startX: number; startY: number; from: Crop } | null>(null);

  const move = (dx: number, dy: number, from = crop) => setCrop(clampCrop({ ...from, x: from.x + dx, y: from.y + dy }, size, FRAME));
  const zoom = (value: number) => setCrop((current) => zoomCrop(current, value, size, FRAME));

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, from: crop };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    move(event.clientX - start.startX, event.clientY - start.startY, start.from);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? STEP * 4 : STEP;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[event.key]) move(...moves[event.key]);
    else if (event.key === "+" || event.key === "=") zoom(crop.zoom + 0.1);
    else if (event.key === "-") zoom(crop.zoom - 0.1);
    else return;
    event.preventDefault();
  }

  async function use() {
    setSaving(true);
    await onUse(render(image, cropSource(crop, size, FRAME)));
    setSaving(false);
  }

  const scale = crop.zoom * Math.max(FRAME.width / size.width, FRAME.height / size.height);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-dialog border border-line-popover bg-card p-6 shadow-menu">
          <Dialog.Title className="font-serif text-[22px] leading-tight">Crop your photo</Dialog.Title>
          <Dialog.Description className="text-sm text-muted">
            Drag it, or use the arrow keys, to move it. Themes with a round or square photo show what&apos;s inside the circle.
          </Dialog.Description>
          <div
            role="group"
            tabIndex={0}
            aria-label="Photo crop: arrow keys move the photo, plus and minus zoom"
            className="relative mx-auto cursor-grab touch-none overflow-hidden rounded-control bg-paper select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:cursor-grabbing"
            style={{ width: FRAME.width, height: FRAME.height }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={onKeyDown}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local file being cropped, never uploaded as it is. */}
            <img
              src={image.src}
              alt=""
              draggable={false}
              className="absolute top-0 left-0 max-w-none origin-top-left"
              style={{ width: size.width, height: size.height, transform: `translate(${crop.x}px, ${crop.y}px) scale(${scale})` }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 rounded-full border border-dashed border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)]"
              style={{ width: FRAME.width, height: FRAME.width, top: (FRAME.height - FRAME.width) / 2 }}
            />
          </div>
          <label className="flex items-center gap-3 text-sm text-muted">
            Zoom
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={crop.zoom}
              onChange={(event) => zoom(Number(event.target.value))}
              className="flex-1 accent-primary"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Dialog.Close className={buttonClassName("secondary", "sm")}>Cancel</Dialog.Close>
            <Button size="sm" disabled={saving} onClick={() => void use()}>
              {saving ? "Saving…" : "Use photo"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The cropped part as a JPEG data URL at the stored size, on white (for
 * transparent PNGs). Drawing it anew also drops the file's metadata, such
 * as where it was taken. A busy photo gets a lower quality to fit.
 */
function render(image: HTMLImageElement, source: ReturnType<typeof cropSource>): string {
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_WIDTH;
  canvas.height = PHOTO_HEIGHT;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, PHOTO_WIDTH, PHOTO_HEIGHT);
  for (const quality of [0.88, 0.75, 0.6]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= PHOTO_MAX_LENGTH) return url;
  }
  return canvas.toDataURL("image/jpeg", 0.45);
}
