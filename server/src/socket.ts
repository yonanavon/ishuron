import { Server as IOServer } from 'socket.io';

let io: IOServer | null = null;

export function setIO(server: IOServer): void {
  io = server;
}

export function getIO(): IOServer | null {
  return io;
}

/**
 * Broadcast an event to every socket that has joined the given school's room.
 * Clients join `school:${schoolId}` after they authenticate (handshake auth
 * carries the JWT; the socket handler decodes it and joins the room).
 */
export function emitToSchool(schoolId: number, event: string, payload: unknown): void {
  if (!io) return;
  io.to(`school:${schoolId}`).emit(event, payload);
}
