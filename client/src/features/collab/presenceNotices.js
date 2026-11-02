export const LEAVE_GRACE_MS = 4000;

export const createPresenceNotices = ({ notify, isEnabled, selfId = null, graceMs = LEAVE_GRACE_MS, schedule = setTimeout, cancel = clearTimeout }) => {
  const known = new Map();
  const pendingLeaves = new Map();
  const self = selfId == null ? null : String(selfId);

  const cancelLeave = (id) => {
    if (!pendingLeaves.has(id)) return false;
    cancel(pendingLeaves.get(id));
    pendingLeaves.delete(id);
    return true;
  };

  return {
    roster(users = []) {
      known.clear();
      users.forEach((user) => {
        const id = String(user.id);
        cancelLeave(id);
        known.set(id, user.name);
      });
    },
    joined(user) {
      if (!user?.id) return;
      const id = String(user.id);
      const isReturning = cancelLeave(id);
      const isKnown = known.has(id);
      known.set(id, user.name);
      if (isReturning || isKnown || id === self) return;
      if (isEnabled()) notify('joined', user.name);
    },
    left(userId) {
      if (userId == null) return;
      const id = String(userId);
      if (id === self || !known.has(id) || pendingLeaves.has(id)) return;
      pendingLeaves.set(id, schedule(() => {
        pendingLeaves.delete(id);
        const name = known.get(id);
        known.delete(id);
        if (isEnabled()) notify('left', name);
      }, graceMs));
    },
    dispose() {
      pendingLeaves.forEach((timer) => cancel(timer));
      pendingLeaves.clear();
      known.clear();
    }
  };
};
