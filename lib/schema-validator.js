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
          }
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
// Compiled Validators
// ============================================================================

export const validateGroups = ajv.compile(groupsSchema);
export const validateFarm = ajv.compile(farmSchema);
export const validateRooms = ajv.compile(roomsSchema);

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
    { file: 'rooms.json', validator: validateRooms, type: 'rooms' }
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
    rooms: '1.0.0'
  };
}

export default {
  validateGroups,
  validateFarm,
  validateRooms,
  validateWithErrors,
  validateAllDataFiles,
  getSchemaVersions
};
