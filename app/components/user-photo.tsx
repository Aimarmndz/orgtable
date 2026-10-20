// A person's profile photo, or what each place already showed without one (its initials):
// `children` is that fallback. No "use client": presentation only. The URL carries the stored
// name, so a new photo is a new URL and the long cache of the route is safe.

export type PhotoUser = { id: string; name: string; avatarStoredName?: string | null };

export function avatarUrl(user: PhotoUser): string | null {
  return user.avatarStoredName
    ? `/api/users/${user.id}/avatar?v=${encodeURIComponent(user.avatarStoredName)}`
    : null;
}

export function UserPhoto({
  user,
  size,
  className = "",
  children,
}: {
  user: PhotoUser;
  size: number;
  className?: string;
  children: React.ReactNode;
}) {
  const src = avatarUrl(user);
  if (!src) return <>{children}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- an authorized route, not a static asset.
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-full bg-surface-2 object-cover ${className}`}
    />
  );
}
