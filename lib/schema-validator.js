/**
 * Data Format Schema Validators
 * 
 * These schemas enforce the canonical data formats defined in DATA_FORMAT_STANDARDS.md
 * 
 * IMPORTANT: Do NOT modify schemas without following the change request process
 * documented in DATA_FORMAT_STANDARDS.md
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// ============================================================================
// Groups Schema (groups.json)
// Schema Version: 1.0.0
// ============================================================================

const groupsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://lightengine.farm/schemas/groups.v1.json',
  type: 'object',
  required: ['groups'],
  properties: {
    schemaVersion: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
      description: 'Semantic version of the groups schema'
    },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'zone', 'trays', 'plants'],
        allOf: [
          {
            anyOf: [
              { required: ['plan'] },
              { required: ['crop'] }
            ]
          },
          {
            anyOf: [
              { required: ['room'] },
              { required: ['roomId'] }
            ]
          }
        ],
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            pattern: '^[^:]+:[^:]+:.+$',
            description: 'Unique group identifier in format RoomId:ZoneId:GroupName'
          },
          name: {
            type: 'string',
            minLength: 1,
            description: 'Human-readable group name'
          },
          roomId: {
            type: 'string',
            minLength: 1,
            description: 'Parent room identifier (NOT "room")'
          },
          room: {
            type: 'string',
            minLength: 1,
            description: 'Parent room name (canonical)'
          },
          zone: {
            type: 'string',
            minLength: 1,
            description: 'Zone identifier within room'
          },
          crop: {
            type: 'string',
            minLength: 1,
            description: 'Primary crop identifier (NOT "recipe")'
          },
          plan: {
            type: 'string',
            minLength: 1,
            description: 'Canonical crop plan identifier'
          },
          status: {
            type: 'string',
            enum: ['active', 'planned', 'completed', 'archived', 'deployed', 'growing'],
            description: 'Current group status'
          },
          trays: {
            type: 'number',
            minimum: 0,
            description: 'Number of trays (NOT array)'
          },
          plants: {
            type: 'number',
            minimum: 0,
            description: 'Total plant count'
          },
          planConfig: {
            type: 'object',
            description: 'Optional growth plan configuration',
            properties: {
              anchor: {
                type: 'object',
                properties: {
                  seedDate: {
                    type: 'string',
                    format: 'date-time',
                    description: 'ISO8601 seed date'
                  }
                }
              },
              schedule: {
                type: 'object',
                properties: {
                  photoperiodHours: {
                    type: 'number',
                    minimum: 0,
                    maximum: 24,
                    description: 'Daily light hours'
                  }
                }
              }
            }
          },
          lights: {
            type: 'array',
            description: 'Optional array of assigned light devices',
            items: {
              type: 'object',
              properties: {
                deviceId: { type: 'string' },
                recipe: { type: 'object' }
              }
            }
          }
        },
        additionalProperties: true  // Allow extensions, but warn
      }
    },
    metadata: {
      type: 'object',
      description: 'Optional metadata block'
    }
  },
  additionalProperties: false
};

// ============================================================================
// Farm Schema (farm.json)
// Schema Version: 1.0.0
// ============================================================================

const farmSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://lightengine.farm/schemas/farm.v1.json',
  type: 'object',
  required: ['farmId', 'name'],
  properties: {
    schemaVersion: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+$'
    },
    farmId: {
      type: 'string',
      pattern: '^FARM-[A-Z0-9-]+-[A-Z0-9]+$',
      description: 'Unique farm identifier'
    },
    name: {
      type: 'string',
      minLength: 1,
      description: 'Farm name'
    },
    status: {
      type: 'string',
      enum: ['online', 'offline', 'maintenance', 'demo'],
      description: 'Farm operational status'
    },
    region: {
      type: 'string',
      description: 'Geographic region'
    },
    location: {
      type: 'string',
      description: 'City, State/Province'
    },
    contact: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        phone: { type: 'string' }
      }
    },
    coordinates: {
      type: 'object',
      properties: {
        lat: { type: 'number', minimum: -90, maximum: 90 },
        lng: { type: 'number', minimum: -180, maximum: 180 }
      }
    }
  },
  additionalProperties: true
};

// ============================================================================
// Rooms Schema (rooms.json)
// Schema Version: 1.0.0
// ============================================================================

// Phase-A build-plan subschemas. All optional on a room today so the
// existing, pre-Phase-A rows continue to validate. Rooms that have been
// through the new "build the farm" flow will populate these fields;
// docs/features/ROOM_BUILD_PLAN_SCHEMA.md has the semantics.

const ROOM_ENVELOPE_CLASSES = [
  'well_insulated',
  'typical',
  'poorly_insulated',
  'outdoor_ambient'
];

const BUILD_PLAN_STATUSES = ['draft', 'accepted', 'stale'];

const CONTROLLER_ANCHOR_KINDS = [
  'switchbot_cloud',
  'kasa_cloud',
  'code3_cloud',
  'dmx_universe',
  'direct_wired',
  'mixed',
  'none'
];

const SYSTEM_SUBSYSTEMS = ['lights', 'pumps', 'fans', 'sensors'];

const roomDimensionsSchema = {
  type: 'object',
  description: 'Physical room dimensions in metres. Drives load math.',
  required: ['lengthM', 'widthM', 'ceilingHeightM'],
  additionalProperties: false,
  properties: {
    lengthM: { type: 'number', exclusiveMinimum: 0 },
    widthM: { type: 'number', exclusiveMinimum: 0 },
    ceilingHeightM: { type: 'number', exclusiveMinimum: 0 }
  }
};

const roomEnvelopeSchema = {
  type: 'object',
  description: 'Building envelope class. Drives HVAC / dehum sizing.',
  required: ['class'],
  additionalProperties: false,
  properties: {
    class: { type: 'string', enum: ROOM_ENVELOPE_CLASSES },
    notes: { type: 'string' }
  }
};

const installedSystemSchema = {
  type: 'object',
  description: 'A grow-system template installed in this room.',
  required: ['templateId', 'quantity'],
  additionalProperties: false,
  properties: {
    templateId: {
      type: 'string',
      minLength: 1,
      description: 'Must resolve to a templates[].id in grow-systems.json.'
    },
    quantity: { type: 'integer', minimum: 1 },
    position: {
      type: 'string',
      description: 'Optional human-readable placement note (e.g. "north wall, row 1").'
    },
    zoneId: {
      type: 'string',
      description: 'Optional binding to a zones[].id in this room.'
    }
  }
};

const buildPlanSchema = {
  type: 'object',
  description: 'Phase-A build plan: computed load + accepted equipment + reserved controller slots.',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: BUILD_PLAN_STATUSES },
    generatedAt: { type: 'string', format: 'date-time' },
    computedLoad: {
      type: 'object',
      description: 'Calculator outputs. Populated by the load-math library (Phase-A step 3).',
      additionalProperties: false,
      properties: {
        lightingKW: { type: 'number', minimum: 0 },
        coolingTons: { type: 'number', minimum: 0 },
        dehumLPerDay: { type: 'number', minimum: 0 },
        supplyFanCFM: { type: 'number', minimum: 0 },
        pumpKW: { type: 'number', minimum: 0 },
        totalCircuitKW: { type: 'number', minimum: 0 }
      }
    },
    acceptedEquipment: {
      type: 'array',
      description: 'Equipment the grower accepted from the proposed BOM.',
      items: {
        type: 'object',
        required: ['category', 'quantity'],
        additionalProperties: false,
        properties: {
          category: { type: 'string', minLength: 1 },
          templateId: { type: 'string' },
          equipmentRef: {
            type: 'string',
            description: 'Optional catalog reference (e.g. an equipment-kb.json id).'
          },
          quantity: { type: 'integer', minimum: 1 },
          notes: { type: 'string' }
        }
      }
    },
    reservedControllerSlots: {
      type: 'array',
      description: 'Channel reservations that device discovery (Phase B) will bind real devices into.',
      items: {
        type: 'object',
        required: ['subsystem', 'controllerClass', 'channels'],
        additionalProperties: false,
        properties: {
          subsystem: { type: 'string', enum: SYSTEM_SUBSYSTEMS },
          controllerClass: { type: 'string', minLength: 1 },
          channels: { type: 'integer', minimum: 1 },
          templateId: { type: 'string' },
          zoneId: { type: 'string' }
        }
      }
    }
  }
};

const controllerAnchorSchema = {
  type: 'object',
  description: 'Room-level vendor-cloud / wired controller anchor. "None" means unassigned.',
  required: ['kind'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: CONTROLLER_ANCHOR_KINDS },
    vendor: { type: 'string' },
    tenantRef: {
      type: 'string',
      description: 'Opaque vendor-tenant identifier (SwitchBot account, Kasa email, DMX universe id). Device identities still live in iot-devices.json.'
    },
    notes: { type: 'string' }
  }
};

const roomsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://lightengine.farm/schemas/rooms.v1.json',
  type: 'object',
  required: ['rooms'],
  properties: {
    schemaVersion: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+$'
    },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            description: 'Unique room identifier'
          },
          name: {
            type: 'string',
            minLength: 1,
            description: 'Room name'
          },
          zones: {
            type: 'array',
            description: 'Zones within this room',
            items: {
              type: 'object',
              required: ['id', 'name'],
              properties: {
                id: {
                  type: 'string',
                  minLength: 1,
                  description: 'Zone identifier'
                },
                name: {
                  type: 'string',
                  minLength: 1,
                  description: 'Zone name'
                }
              }
            }
          },
          dimensions: roomDimensionsSchema,
          envelope: roomEnvelopeSchema,
          installedSystems: {
            type: 'array',
            description: 'Grow-system templates installed in this room.',
            items: installedSystemSchema
          },
          buildPlan: buildPlanSchema,
          controllerAnchor: controllerAnchorSchema
        }
      }
    },
    metadata: {
      type: 'object',
      description: 'Optional metadata block'
    }
  },
  additionalProperties: false
};

// ============================================================================
// Grow Systems Schema (grow-systems.json)
// Schema Version: 1.0.0
//
// Enforces the class-level template catalog documented in
// docs/features/GROW_SYSTEMS_TEMPLATE_SCHEMA.md. Two invariants the
// schema exists specifically to guard:
//   1. No device identities (MAC, DMX universe, Kasa/SwitchBot/Modbus
//      deviceIds) — enforced by `additionalProperties: false` on every
//      controller/fixture subobject so unknown keys fail the build.
//   2. Every *ByClass map covers all four crop classes — enforced by
//      making every cropClass key `required` with
//      `additionalProperties: false` on the map itself.
// ============================================================================

const CROP_CLASSES = ['leafy_greens', 'microgreens', 'herbs', 'fruiting'];

function byClassMap(valueSchema, description) {
  const props = {};
  for (const cls of CROP_CLASSES) {
    props[cls] = valueSchema;
  }
  return {
    type: 'object',
    description,
    required: [...CROP_CLASSES],
    additionalProperties: false,
    properties: props
  };
}

const numberNonNegative = { type: 'number', minimum: 0 };
const integerNonNegative = { type: 'integer', minimum: 0 };
const integerPositive = { type: 'integer', minimum: 1 };

const growSystemsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://lightengine.farm/schemas/grow-systems.v1.json',
  type: 'object',
  required: ['version', 'cropClasses', 'templates'],
  additionalProperties: false,
  properties: {
    schemaVersion: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
      description: 'Semantic version of the grow-systems schema.'
    },
    version: {
      type: 'string',
      minLength: 1,
      description: 'Registry content version string (ISO date + suffix).'
    },
    description: {
      type: 'string',
      description: 'Free-form summary of what this registry is.'
    },
    cropClasses: {
      type: 'array',
      description: 'Closed enum of crop classes used as keys in every *ByClass map.',
      minItems: CROP_CLASSES.length,
      maxItems: CROP_CLASSES.length,
      uniqueItems: true,
      items: { type: 'string', enum: CROP_CLASSES }
    },
    templates: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: [
          'id',
          'name',
          'category',
          'description',
          'suitableCropClasses',
          'footprintM',
          'heightM',
          'tierCount',
          'traysPerTier',
          'trayFormat',
          'plantsPerTrayByClass',
          'irrigation',
          'transpiration',
          'defaultFixtureClass',
          'defaultControllerClass',
          'requiredChannels',
          'powerClassW'
        ],
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            pattern: '^[a-z0-9][a-z0-9-]*$',
            description: 'Stable slug identifier.'
          },
          name: { type: 'string', minLength: 1 },
          category: {
            type: 'string',
            enum: [
              'nft_rack',
              'dwc_pond',
              'vertical_tier',
              'microgreen_shelf',
              'flood_table',
              'ebb_flow_bench',
              'drip_rail',
              'aeroponic_tower',
              'tower_wall'
            ]
          },
          description: { type: 'string', minLength: 1 },
          tagline: { type: 'string' },
          image: { type: 'string' },
          defaultCropClass: { type: 'string', enum: CROP_CLASSES },
          lightingSpecSummary: { type: 'string' },
          suitableCropClasses: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { type: 'string', enum: CROP_CLASSES }
          },
          footprintM: {
            type: 'object',
            required: ['length', 'width'],
            additionalProperties: false,
            properties: {
              length: { type: 'number', exclusiveMinimum: 0 },
              width: { type: 'number', exclusiveMinimum: 0 }
            }
          },
          heightM: { type: 'number', exclusiveMinimum: 0 },
          tierCount: integerPositive,
          traysPerTier: integerPositive,
          trayFormat: {
            type: 'object',
            required: ['lengthIn', 'widthIn', 'plantsPerTrayDefault'],
            additionalProperties: false,
            properties: {
              lengthIn: { type: 'number', exclusiveMinimum: 0 },
              widthIn: { type: 'number', exclusiveMinimum: 0 },
              plantsPerTrayDefault: integerPositive
            }
          },
          plantsPerTrayByClass: byClassMap(
            integerNonNegative,
            'Plant density per tray, keyed by cropClass.'
          ),
          irrigation: {
            type: 'object',
            required: [
              'type',
              'supplyPumpWattsPer10kPlants',
              'returnPumpWattsPer10kPlants',
              'dutyCycle',
              'reservoirGalPerPlant',
              'plumbingCostPer10kPlantsUsd'
            ],
            additionalProperties: false,
            properties: {
              type: {
                type: 'string',
                enum: ['nft', 'dwc', 'aero', 'flood', 'drip']
              },
              supplyPumpWattsPer10kPlants: numberNonNegative,
              returnPumpWattsPer10kPlants: numberNonNegative,
              dutyCycle: { type: 'number', minimum: 0, maximum: 1 },
              reservoirGalPerPlant: numberNonNegative,
              plumbingCostPer10kPlantsUsd: numberNonNegative
            }
          },
          transpiration: {
            type: 'object',
            required: ['gPerPlantPerDayByClass', 'sensibleHeatFactor'],
            additionalProperties: false,
            properties: {
              gPerPlantPerDayByClass: byClassMap(
                numberNonNegative,
                'Mean transpiration per plant per day, keyed by cropClass.'
              ),
              sensibleHeatFactor: { type: 'number', minimum: 0, maximum: 1 }
            }
          },
          defaultFixtureClass: {
            type: 'object',
            required: [
              'ppfdTargetByClass',
              'dliTargetByClass',
              'efficacyUmolPerJ',
              'fixtureWattsNominal',
              'fixturesPerTierUnit',
              'photoperiodHoursByClass'
            ],
            additionalProperties: false,
            properties: {
              ppfdTargetByClass: byClassMap(numberNonNegative, 'µmol/m²/s per cropClass.'),
              dliTargetByClass: byClassMap(numberNonNegative, 'mol/m²/day per cropClass.'),
              efficacyUmolPerJ: { type: 'number', exclusiveMinimum: 0 },
              fixtureWattsNominal: { type: 'number', exclusiveMinimum: 0 },
              fixturesPerTierUnit: integerPositive,
              photoperiodHoursByClass: byClassMap(
                { type: 'number', minimum: 0, maximum: 24 },
                'On-hours per cropClass.'
              )
            }
          },
          defaultControllerClass: {
            type: 'object',
            required: ['lights', 'pumps', 'fans', 'sensors'],
            additionalProperties: false,
            properties: {
              lights: {
                type: 'object',
                required: ['type', 'channelsPerFixturePair'],
                additionalProperties: false,
                properties: {
                  type: {
                    type: 'string',
                    enum: ['dmx_4', '0_10v', 'smart_plug', 'direct_wired']
                  },
                  channelsPerFixturePair: integerPositive
                }
              },
              pumps: {
                type: 'object',
                required: ['type', 'channelsPerPumpPair'],
                additionalProperties: false,
                properties: {
                  type: {
                    type: 'string',
                    enum: ['smart_plug', 'relay', 'modbus']
                  },
                  channelsPerPumpPair: integerPositive
                }
              },
              fans: {
                type: 'object',
                required: ['type', 'channelsPerFan'],
                additionalProperties: false,
                properties: {
                  type: {
                    type: 'string',
                    enum: ['ec_fan', 'pwm', 'smart_plug']
                  },
                  channelsPerFan: integerPositive
                }
              },
              sensors: {
                type: 'object',
                required: ['type', 'channelsPerZone'],
                additionalProperties: false,
                properties: {
                  type: {
                    type: 'string',
                    enum: ['switchbot_cloud', 'modbus', '1_wire', 'http']
                  },
                  channelsPerZone: integerPositive
                }
              }
            }
          },
          requiredChannels: {
            type: 'object',
            required: [
              'lightsPerTier',
              'pumpsPer10kPlants',
              'fansPer5Racks',
              'sensorsPerZone'
            ],
            additionalProperties: false,
            properties: {
              lightsPerTier: integerPositive,
              pumpsPer10kPlants: integerPositive,
              fansPer5Racks: integerPositive,
              sensorsPerZone: integerPositive
            }
          },
          powerClassW: {
            type: 'object',
            required: ['lightsPerTierUnit', 'pumpsPer10kPlants', 'fansPerUnit'],
            additionalProperties: false,
            properties: {
              lightsPerTierUnit: numberNonNegative,
              pumpsPer10kPlants: numberNonNegative,
              fansPerUnit: numberNonNegative
            }
          },
          references: {
            type: 'object',
            description: 'Free-form pointers to VFC sections or engineering notes.',
            additionalProperties: true
          }
        }
      }
    }
  }
};

// ============================================================================
// Compiled Validators
// ============================================================================

export const validateGroups = ajv.compile(groupsSchema);
export const validateFarm = ajv.compile(farmSchema);
export const validateRooms = ajv.compile(roomsSchema);
export const validateGrowSystems = ajv.compile(growSystemsSchema);

/**
 * Validate data with detailed error reporting
 */
export function validateWithErrors(validator, data, dataType = 'data') {
  const valid = validator(data);
  
  if (!valid) {
    const errors = validator.errors.map(err => ({
      field: err.instancePath || '/' + err.params?.missingProperty,
      message: err.message,
      keyword: err.keyword,
      params: err.params
    }));
    
    return {
      valid: false,
      errors,
      summary: `${dataType} validation failed with ${errors.length} error(s)`
    };
  }
  
  return { valid: true, errors: [] };
}

/**
 * Validate all data files
 */
export async function validateAllDataFiles(dataDir = './public/data') {
  const fs = await import('fs');
  const path = await import('path');
  
  const validators = [
    { file: 'groups.json', validator: validateGroups, type: 'groups' },
    { file: 'farm.json', validator: validateFarm, type: 'farm' },
    { file: 'rooms.json', validator: validateRooms, type: 'rooms' },
    { file: 'grow-systems.json', validator: validateGrowSystems, type: 'grow-systems' }
  ];
  
  const results = [];
  
  for (const { file, validator, type } of validators) {
    const filePath = path.join(dataDir, file);
    
    if (!fs.existsSync(filePath)) {
      results.push({
        file,
        valid: false,
        errors: [{ message: 'File not found' }]
      });
      continue;
    }
    
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const result = validateWithErrors(validator, data, type);
      results.push({ file, ...result });
    } catch (err) {
      results.push({
        file,
        valid: false,
        errors: [{ message: `Parse error: ${err.message}` }]
      });
    }
  }
  
  return results;
}

/**
 * Get schema versions
 */
export function getSchemaVersions() {
  return {
    groups: '1.0.0',
    farm: '1.0.0',
    rooms: '1.0.0',
    'grow-systems': '1.0.0'
  };
}

export default {
  validateGroups,
  validateFarm,
  validateRooms,
  validateGrowSystems,
  validateWithErrors,
  validateAllDataFiles,
  getSchemaVersions
};
