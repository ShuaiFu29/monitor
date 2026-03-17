import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../src/context';

describe('SessionManager', () => {
  let session: SessionManager;

  beforeEach(() => {
    session = new SessionManager();
  });

  describe('sessionId', () => {
    it('should generate a sessionId on creation', () => {
      expect(session.getSessionId()).toBeTruthy();
      expect(typeof session.getSessionId()).toBe('string');
    });

    it('should return the same sessionId on multiple calls', () => {
      const id1 = session.getSessionId();
      const id2 = session.getSessionId();
      expect(id1).toBe(id2);
    });

    it('should generate a new sessionId on renewSession', () => {
      const oldId = session.getSessionId();
      session.renewSession();
      const newId = session.getSessionId();
      expect(newId).not.toBe(oldId);
    });
  });

  describe('user management', () => {
    it('should start with empty user', () => {
      const user = session.getUser();
      expect(user).toEqual({});
    });

    it('should set user information', () => {
      session.setUser({ id: 'user-1', email: 'test@test.com' });
      expect(session.getUser()).toEqual({ id: 'user-1', email: 'test@test.com' });
    });

    it('should merge user information on subsequent calls', () => {
      session.setUser({ id: 'user-1' });
      session.setUser({ email: 'test@test.com' });
      expect(session.getUser()).toEqual({ id: 'user-1', email: 'test@test.com' });
    });

    it('should return userId', () => {
      expect(session.getUserId()).toBeUndefined();
      session.setUser({ id: 'user-1' });
      expect(session.getUserId()).toBe('user-1');
    });

    it('should return a copy of user info', () => {
      session.setUser({ id: 'user-1' });
      const user1 = session.getUser();
      const user2 = session.getUser();
      expect(user1).toEqual(user2);
      expect(user1).not.toBe(user2);
    });
  });

  describe('getEventContext', () => {
    it('should return context with sessionId', () => {
      const ctx = session.getEventContext();
      expect(ctx.sessionId).toBe(session.getSessionId());
    });

    it('should include userId when set', () => {
      session.setUser({ id: 'u-123' });
      const ctx = session.getEventContext();
      expect(ctx.userId).toBe('u-123');
    });

    it('should include sessionDuration', () => {
      const ctx = session.getEventContext();
      expect(ctx.sessionDuration).toBeDefined();
      expect(typeof ctx.sessionDuration).toBe('number');
    });
  });
});
