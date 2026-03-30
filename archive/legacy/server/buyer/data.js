const SHARE_POLICY_COPY = "Owners choose if/what to share.";

const BUYER_NAVIGATION = [
  {
    id: "wishlists",
    label: "Review your Wishlist",
    href: "/buyers/wishlists",
    ariaLabel: "Review your Wishlist",
  },
  {
    id: "budget",
    label: "Budget Coach",
    href: "/buyers/budget-coach",
    ariaLabel: "Budget Coach",
  },
  {
    id: "messages",
    label: "Messages",
    href: "/buyers/messages",
    ariaLabel: "Messages",
  },
  {
    id: "account",
    label: "Account",
    href: "/buyers/account",
    ariaLabel: "Account",
  },
];

const BUYER_NOTIFICATIONS = new Map([
  [
    "buyer-001",
    [
      {
        id: "note-01",
        type: "match-summary",
        headline: "3 homes match your Wishlist fit",
        body: "3 matching homes fit what you are looking for right now. Focus on how many align with your Wishlist criteria—owners share more as trust builds.",
        cta: {
          label: "Review your Wishlist",
          href: "/buyers/wishlists/buyer-001",
        },
      },
    ],
  ],
]);

const WISHLIST_SNAPSHOTS = new Map([
  [
    "wishlist-001",
    {
      wishlistId: "wishlist-001",
      buyerId: "buyer-001",
      updatedAt: new Date("2024-03-01T12:00:00.000Z").toISOString(),
      matchingHomes: {
        label: "Matching homes (owners): count only",
        count: 3,
      },
      ownersSharing: {
        label: "Matching homes (owners): count only",
        count: 2,
      },
      priceExpectation: {
        label: "Price expectation",
        median: 485000,
        currency: "USD",
        range: {
          min: 450000,
          max: 525000,
        },
      },
      guidance: {
        primaryCta: "Review your Wishlist",
        privacy: SHARE_POLICY_COPY,
        budgetCoach: "Budget Coach is using your Wishlist fit—no property sheets involved.",
      },
    },
  ],
]);

const HOMES = new Map([
  [
    "home-001",
    {
      id: "home-001",
      ownerId: "owner-001",
      summary: "Sunny 3-bedroom with flexible spaces",
      wishlistFit: {
        fitScore: 87,
        highlights: [
          "Meets natural light expectations",
          "Within preferred neighborhood radius",
        ],
      },
      address: {
        line1: "123 Garden View Ave",
        city: "Evergreen",
        state: "OR",
        postalCode: "97035",
      },
      photos: [
        {
          id: "photo-001",
          url: "https://example.com/home-001/main.jpg",
          alt: "Living room with large windows",
        },
      ],
      priceExpectation: {
        label: "Price expectation",
        low: 460000,
        high: 510000,
        currency: "USD",
      },
      ownerNotes: "Prefers buyers who appreciate native landscaping.",
      contact: {
        name: "Jamie Owner",
        email: "jamie@example.com",
        phone: "503-555-1111",
      },
    },
  ],
  [
    "home-002",
    {
      id: "home-002",
      ownerId: "owner-002",
      summary: "Townhome with rooftop garden",
      wishlistFit: {
        fitScore: 78,
        highlights: ["Aligns with work-from-home setup"],
      },
      address: {
        line1: "42 Market Street",
        city: "Evergreen",
        state: "OR",
        postalCode: "97035",
      },
      photos: [
        {
          id: "photo-002",
          url: "https://example.com/home-002/front.jpg",
          alt: "Townhome exterior with rooftop garden",
        },
      ],
      priceExpectation: {
        label: "Price expectation",
        low: 395000,
        high: 420000,
        currency: "USD",
      },
      ownerNotes: "Open to flexible close date.",
      contact: {
        name: "Alex Owner",
        email: "alex@example.com",
        phone: "503-555-2222",
      },
    },
  ],
]);

const HOME_SHARE_SEED = [
  {
    token: "share-abc-123",
    homeId: "home-001",
    buyerId: "buyer-001",
    scope: {
      address: false,
      photos: false,
    },
    issuedAt: new Date("2024-03-01T12:30:00.000Z").toISOString(),
    revoked: false,
  },
  {
    token: "share-extended-001",
    homeId: "home-001",
    buyerId: "buyer-001",
    scope: {
      address: true,
      photos: true,
    },
    issuedAt: new Date("2024-03-02T09:00:00.000Z").toISOString(),
    revoked: false,
  },
];

let homeShareStore = new Map(HOME_SHARE_SEED.map((share) => [share.token, { ...share }]));

export function getNavigationItems() {
  return BUYER_NAVIGATION.map((item) => ({ ...item }));
}

export function getNotificationsForBuyer(buyerId) {
  return (BUYER_NOTIFICATIONS.get(buyerId) || []).map((notification) => ({
    ...notification,
    cta: notification.cta ? { ...notification.cta } : undefined,
  }));
}

export function getWishlistSnapshot(wishlistId) {
  const snapshot = WISHLIST_SNAPSHOTS.get(wishlistId);
  if (!snapshot) return null;
  return {
    ...snapshot,
    matchingHomes: { ...snapshot.matchingHomes },
    ownersSharing: { ...snapshot.ownersSharing },
    priceExpectation: {
      ...snapshot.priceExpectation,
      range: { ...snapshot.priceExpectation.range },
    },
    guidance: { ...snapshot.guidance },
  };
}

export function getHomeById(homeId) {
  const home = HOMES.get(homeId);
  if (!home) return null;
  return {
    ...home,
    address: { ...home.address },
    photos: home.photos.map((photo) => ({ ...photo })),
    priceExpectation: { ...home.priceExpectation },
    wishlistFit: {
      ...home.wishlistFit,
      highlights: [...(home.wishlistFit.highlights || [])],
    },
  };
}

export function getShareByToken(token) {
  if (!token) return null;
  const share = homeShareStore.get(token);
  if (!share || share.revoked) return null;
  return {
    ...share,
    scope: { ...share.scope },
  };
}

export function revokeShare(token) {
  if (!token) return false;
  const share = homeShareStore.get(token);
  if (!share) return false;
  homeShareStore.set(token, {
    ...share,
    revoked: true,
    revokedAt: new Date().toISOString(),
  });
  return true;
}

export function resetShares() {
  homeShareStore = new Map(HOME_SHARE_SEED.map((share) => [share.token, { ...share }]));
}

export function projectHomeForScope(home, scope = {}) {
  if (!home) return null;
  const safeScope = {
    address: Boolean(scope.address),
    photos: Boolean(scope.photos),
  };

  const base = {
    id: home.id,
    summary: home.summary,
    wishlistFit: {
      fitScore: home.wishlistFit.fitScore,
      highlights: [...(home.wishlistFit.highlights || [])],
    },
    priceExpectation: { ...home.priceExpectation },
    sharePolicy: SHARE_POLICY_COPY,
  };

  if (safeScope.address) {
    base.address = { ...home.address };
  } else {
    base.address = {
      city: home.address.city,
      state: home.address.state,
      postalCode: home.address.postalCode ? home.address.postalCode.slice(0, 3) + "**" : undefined,
      masked: true,
    };
  }

  if (safeScope.photos) {
    base.photos = home.photos.map((photo) => ({ id: photo.id, url: photo.url, alt: photo.alt }));
  } else {
    base.photosAvailable = false;
  }

  base.guidance = {
    privacy: SHARE_POLICY_COPY,
    nextStep: "Review your Wishlist to request more detail directly inside the app.",
  };

  return base;
}

export function getSharePolicyCopy() {
  return SHARE_POLICY_COPY;
}
