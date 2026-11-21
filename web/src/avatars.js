// Self-hosted portrait set. DiceBear "Notionists" (CC0/public domain), rendered once at
// build time so the demo never depends on a third-party image host at showtime.
export const AVATARS = Array.from({ length: 48 }, (_, i) => `avatars/a${String(i + 1).padStart(2, '0')}.svg`)

// Persona portraits stay stable across renders and across the server round trip, because the
// card only persists the profile and the picture is derived from it.
const seed = (value) => {
  let h = 2166136261
  for (const ch of String(value)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) }
  return (h >>> 0) % AVATARS.length
}

export const avatarForProfile = (profile) => AVATARS[seed(
  [profile?.alias, profile?.role, profile?.agent, profile?.task, profile?.months, profile?.paid, profile?.late].join('|')
)]

export const avatarForUser = (user) => user ? AVATARS[seed('account:' + user.id)] : AVATARS[AVATARS.length - 1]

export const avatarWall = (count = 12) => Array.from({ length: count }, (_, i) => AVATARS[(i * 7 + 3) % AVATARS.length])
