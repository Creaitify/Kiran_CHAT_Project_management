import { useCallback, useEffect, useState } from "react";

export interface ProfilePhoto {
  dataUrl: string;
  zoom: number;
  x: number;
  y: number;
}

const PREFIX = "nexus-profile-photo";
const CHANGE_EVENT = "nexus-profile-photo-change";

function photoKey(userId: string) {
  return `${PREFIX}:${userId}`;
}

function readPhoto(key: string): ProfilePhoto | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ProfilePhoto>;
    if (typeof value.dataUrl !== "string") return null;
    return {
      dataUrl: value.dataUrl,
      zoom: typeof value.zoom === "number" ? value.zoom : 1,
      x: typeof value.x === "number" ? value.x : 50,
      y: typeof value.y === "number" ? value.y : 50,
    };
  } catch {
    return null;
  }
}

export function useUserProfilePhoto(userId: string) {
  const key = photoKey(userId);
  const [photo, setPhotoState] = useState<ProfilePhoto | null>(null);

  useEffect(() => {
    setPhotoState(readPhoto(key));
    const sync = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== key) return;
      if (event instanceof CustomEvent && event.detail !== key) return;
      setPhotoState(readPhoto(key));
    };
    window.addEventListener("storage", sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, [key]);

  const setOwnPhoto = useCallback(
    (actorUserId: string, value: ProfilePhoto | null) => {
      if (actorUserId !== userId) return false;
      try {
        if (value) window.localStorage.setItem(key, JSON.stringify(value));
        else window.localStorage.removeItem(key);
        setPhotoState(value);
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
        return true;
      } catch {
        return false;
      }
    },
    [key, userId],
  );

  return { photo, setOwnPhoto };
}

export async function prepareProfilePhoto(file: File): Promise<string> {
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
  const maxEdge = 1024;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", 0.86);
}
