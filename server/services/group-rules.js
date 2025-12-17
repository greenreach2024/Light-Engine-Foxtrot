// server/services/group-rules.js
// Stub implementation for rule-managed group check. Replace with your actual logic.


function isRuleManagedGroup(group) {
  if (!group || !group.rules) return false;
  // Example rule shape: { type: 'room'|'zone'|'manual', active: true }
  // Consider the rule active if any rule of type room/zone is active.
  return group.rules.some(r => r.active && (r.type === 'room' || r.type === 'zone'));
}

module.exports = {
  isRuleManagedGroup,
};
