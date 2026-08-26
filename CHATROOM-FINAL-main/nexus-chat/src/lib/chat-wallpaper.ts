import { useCallback, useEffect, useState } from "react";

const PREFIX = "nexus-chat-wallpaper";
const CHANGE_EVENT = "nexus-chat-wallpaper-change";

function wallpaperKey(userId: string, roomId: string) {
  return `${PREFIX}:${userId}:${roomId}`;
}

function readWallpaper(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useChatWallpaper(userId: string, roomId: string) {
  const key = wallpaperKey(userId, roomId);
  const [wallpaper, setWallpaperState] = useState<string | null>(null);

  useEffect(() => {
    setWallpaperState(readWallpaper(key));
    const sync = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== key) return;
      if (event instanceof CustomEvent && event.detail !== key) return;
      setWallpaperState(readWallpaper(key));
    };
    window.addEventListener("storage", sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, [key]);

  const setWallpaper = useCallback(
    (value: string | null) => {
      try {
        if (value) window.localStorage.setItem(key, value);
        else window.localStorage.removeItem(key);
        setWallpaperState(value);
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
        return true;
      } catch {
        return false;
      }
    },
    [key],
  );

  return { wallpaper, setWallpaper };
}

export async function prepareWallpaper(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Could not decode image"));
    element.src = source;
  });

  const maxEdge = 1920;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", 0.82);
}
