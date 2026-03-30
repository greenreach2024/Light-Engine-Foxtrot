// server/controllers/addMember.js
// Controller for adding a member to a group, with rule-managed group guard.

const { getGroupById, addUserToGroup } = require('../models/groups');
const { isRuleManagedGroup } = require('../services/group-rules');

async function addMember(req, res, next) {
  try {
    const groupId = req.params.groupId;
    const userId = req.body.userId;

    const group = await getGroupById(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Guard: block manual roster edits for rule-managed groups (room/zone rule)
    if (isRuleManagedGroup(group)) {
      return res.status(409).json({
        error: 'Group membership is managed by an active rule and cannot be edited manually.',
        code: 'rule_managed_group',
      });
    }

    // proceed with add
    const updated = await addUserToGroup(groupId, userId);

    return res.status(200).json({ group: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  addMember,
};
