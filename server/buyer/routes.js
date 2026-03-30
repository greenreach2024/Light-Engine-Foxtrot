import express from "express";
import {
  getNavigationItems,
  getNotificationsForBuyer,
  getWishlistSnapshot,
  getHomeById,
  getShareByToken,
  projectHomeForScope,
  revokeShare,
  resetShares,
  getSharePolicyCopy,
} from "./data.js";

const buyerRouter = express.Router();

buyerRouter.use((req, res, next) => {
  const shareToken = req.headers["x-share-token"];
  if (typeof shareToken === "string") {
    req.homeShareGrant = getShareByToken(shareToken) || null;
  } else if (Array.isArray(shareToken)) {
    const candidate = shareToken.find((value) => typeof value === "string");
    req.homeShareGrant = candidate ? getShareByToken(candidate) : null;
  } else {
    req.homeShareGrant = null;
  }
  next();
});

function requireShareGrant(req, res, next) {
  const { homeShareGrant } = req;
  if (!homeShareGrant) {
    return res.status(403).json({ error: "NO_SHARE", message: "No active share grant for this home." });
  }
  next();
}

buyerRouter.get("/wishlists/:wishlistId/supply-snapshot", (req, res) => {
  const snapshot = getWishlistSnapshot(req.params.wishlistId);
  if (!snapshot) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Wishlist snapshot not found." });
  }

  const response = {
    wishlistId: snapshot.wishlistId,
    buyerId: snapshot.buyerId,
    updatedAt: snapshot.updatedAt,
    matchingHomes: snapshot.matchingHomes,
    ownersSharing: snapshot.ownersSharing,
    priceExpectation: snapshot.priceExpectation,
    guidance: snapshot.guidance,
  };

  res.json(response);
});

buyerRouter.get("/shared/homes/:homeId", requireShareGrant, (req, res) => {
  const home = getHomeById(req.params.homeId);
  if (!home) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Home not found." });
  }

  if (req.homeShareGrant.homeId !== home.id) {
    return res.status(403).json({ error: "NO_SHARE", message: "No active share grant for this home." });
  }

  const projected = projectHomeForScope(home, req.homeShareGrant.scope);
  res.json({ home: projected });
});

buyerRouter.get("/buyers/:buyerId/navigation", (req, res) => {
  res.json({
    items: getNavigationItems().map((item) => ({
      ...item,
      ariaLabel: item.ariaLabel || item.label,
    })),
  });
});

buyerRouter.get("/buyers/:buyerId/notifications", (req, res) => {
  const notifications = getNotificationsForBuyer(req.params.buyerId).map((notification) => ({
    ...notification,
    guidance: getSharePolicyCopy(),
  }));
  res.json({ notifications });
});

buyerRouter.post("/home-shares/:token/revoke", (req, res) => {
  const { token } = req.params;
  const success = revokeShare(token);
  if (!success) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Share token not found." });
  }
  res.status(204).end();
});

buyerRouter.post("/home-shares/reset", (_req, res) => {
  resetShares();
  res.status(204).end();
});

export default buyerRouter;
