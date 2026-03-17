const rawSocketUrl = import.meta.env.VITE_SOCKET_URL;

export const SOCKET_URL =
  typeof rawSocketUrl === 'string' && rawSocketUrl.trim().length > 0
    ? rawSocketUrl.trim()
    : undefined;

export const SOCKET_PATH = import.meta.env.VITE_SOCKET_PATH || '/socket.io';

