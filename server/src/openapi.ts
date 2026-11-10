import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { inputSchema as orderInput } from './modules/orders/service.js';
import {
  categorySchema,
  modifierGroupSchema,
  menuItemSchema,
  floorSchema,
  tableSchema,
  tableStatusSchema,
  versionBodySchema,
} from '@restaurant/shared';

// Contracts are generated from the validation schemas used by the real API.
const source = {
  Category: categorySchema,
  ModifierGroup: modifierGroupSchema,
  MenuItem: menuItemSchema,
  Floor: floorSchema,
  Table: tableSchema,
};
type Json = Record<string, unknown>;
const schemas: Record<string, Json> = {
  Version: z.toJSONSchema(versionBodySchema),
  TableStatus: z.toJSONSchema(tableStatusSchema),
};
for (const [name, schema] of Object.entries(source)) {
  const input = z.toJSONSchema(schema, { io: 'input' });
  const output = z.toJSONSchema(schema);
  schemas[name + 'Input'] = input;
  schemas[name + 'Update'] = {
    ...input,
    properties: { ...input.properties, version: { type: 'integer', minimum: 0 } },
    required: [...(input.required ?? []), 'version'],
  };
  schemas[name] = {
    ...output,
    properties: {
      ...output.properties,
      id: { type: 'string', pattern: '^[a-f0-9]{24}$' },
      version: { type: 'integer', minimum: 0 },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      ...(name === 'Table' ? { status: { enum: ['AVAILABLE', 'RESERVED', 'OCCUPIED'] } } : {}),
    },
    required: [
      ...(output.required ?? []),
      'id',
      'version',
      'createdAt',
      'updatedAt',
      ...(name === 'Table' ? ['status'] : []),
    ],
  };
}
const ref = (name: string) => ({ $ref: '#/components/schemas/' + name });
const body = (name: string) => ({
  required: true,
  content: { 'application/json': { schema: ref(name) } },
});
const envelope = (schema: Json) => ({ type: 'object', properties: { data: schema } });
const response = (description: string, schema?: Json) => ({
  description,
  ...(schema ? { content: { 'application/json': { schema } } } : {}),
});
const errors = {
  '400': response('Invalid input'),
  '401': response('Sign in required'),
  '403': response('Insufficient permission or rejected origin'),
  '404': response('Missing or archived record'),
  '409': response(
    'Version conflict, name/position collision, busy table, unavailable reference or invalid transition',
  ),
};
const idParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
};
const paths: Record<string, Json> = {};
const resources = [
  ['catalog/categories', 'Category', 'menu'],
  ['catalog/modifier-groups', 'ModifierGroup', 'menu'],
  ['catalog/menu-items', 'MenuItem', 'menu'],
  ['dining/floors', 'Floor', 'tables'],
  ['dining/tables', 'Table', 'tables'],
];
for (const [path, name, permission] of resources) {
  const success = response('Committed record', envelope(ref(name)));
  const pagination = {
    type: 'object',
    properties: {
      page: { type: 'integer' },
      limit: { type: 'integer' },
      total: { type: 'integer' },
    },
  };
  const parameters: Json[] = [
    {
      name: 'page',
      in: 'query',
      schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 },
    },
    {
      name: 'limit',
      in: 'query',
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    },
    { name: 'search', in: 'query', schema: { type: 'string', maxLength: 80 } },
    { name: 'sort', in: 'query', schema: { enum: ['name', 'newest'], default: 'name' } },
  ];
  if (name === 'MenuItem')
    parameters.push(
      { name: 'categoryId', in: 'query', schema: { type: 'string' } },
      { name: 'available', in: 'query', schema: { enum: ['true', 'false'] } },
    );
  if (name === 'Table')
    parameters.push({ name: 'floorId', in: 'query', schema: { type: 'string' } });
  paths['/' + path] = {
    get: {
      summary: 'List ' + name + ' records',
      parameters,
      description:
        'Requires ' +
        permission +
        ':read. Active records only. Modifier choices must be unique and minSelections <= maxSelections <= options.length.',
      responses: {
        '200': response(
          'Paginated active records',
          envelope({
            type: 'object',
            properties: { items: { type: 'array', items: ref(name) }, pagination },
          }),
        ),
        ...errors,
      },
    },
    post: {
      summary: 'Create ' + name,
      description: 'Requires ' + permission + ':write. Audit entry commits atomically.',
      requestBody: body(name + 'Input'),
      responses: { '201': success, ...errors },
    },
  };
  paths['/' + path + '/{id}'] = {
    parameters: [idParameter],
    get: {
      summary: 'Get ' + name,
      description: 'Requires ' + permission + ':read.',
      responses: { '200': success, ...errors },
    },
    put: {
      summary: 'Replace editable ' + name + ' fields',
      description: 'Requires ' + permission + ':write and current version.',
      requestBody: body(name + 'Update'),
      responses: { '200': success, ...errors },
    },
    delete: {
      summary: 'Archive ' + name,
      description:
        'Requires ' +
        permission +
        ':write and current version. Active references and busy tables block archiving.',
      requestBody: body('Version'),
      responses: { '200': success, ...errors },
    },
  };
}
paths['/dining/tables/{id}/status'] = {
  parameters: [idParameter],
  patch: {
    summary: 'Change table status',
    requestBody: body('TableStatus'),
    description:
      'Requires tables:operate. AVAILABLE -> RESERVED or OCCUPIED; RESERVED -> AVAILABLE or OCCUPIED; OCCUPIED -> AVAILABLE. Requires current version.',
    responses: { '200': response('Updated table', envelope(ref('Table'))), ...errors },
  },
};
paths['/health'] = {
  get: {
    summary: 'Database readiness',
    security: [],
    responses: { '200': response('Ready; phase 2'), '503': response('Database disconnected') },
  },
};
paths['/auth/login'] = {
  post: {
    summary: 'Password login',
    security: [],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['email', 'password'],
            properties: {
              email: { type: 'string', format: 'email' },
              password: { type: 'string', minLength: 1, maxLength: 128 },
            },
          },
        },
      },
    },
    responses: {
      '200': response('data: {user, accessToken, expiresIn}; HttpOnly refresh cookie set'),
      '401': response('Invalid credentials'),
      '429': response('Sign-in rate limit'),
    },
  },
};
paths['/auth/refresh'] = {
  post: {
    summary: 'Rotate refresh token',
    security: [{ refreshCookie: [] }],
    responses: {
      '200': response('New access token and rotating cookie'),
      '401': response('Invalid, expired or replayed session'),
    },
  },
};
paths['/auth/logout'] = {
  post: {
    summary: 'Revoke session',
    security: [{ refreshCookie: [] }],
    responses: { '204': response('Cookie cleared and session revoked') },
  },
};
paths['/auth/me'] = {
  get: {
    summary: 'Current staff identity and permissions',
    responses: { '200': response('Staff identity'), '401': response('Sign in required') },
  },
};
paths['/staff'] = {
  get: {
    summary: 'Read staff directory',
    description: 'Requires staff:read. Query: page >= 1, limit 1-100.',
    responses: {
      '200': response('data: staff array; pagination: {page, limit, total}'),
      '401': response('Sign in required'),
      '403': response('Permission denied'),
    },
  },
};
schemas.OrderInput = z.toJSONSchema(orderInput);
paths['/orders'] = {
  get: {
    summary: 'Paginated order history; orders:read',
    parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } }],
    responses: { '200': response('data: {items, pagination}') },
  },
  post: {
    summary: 'Save an open order; orders:write',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderInput' } } },
    },
    responses: {
      '201': response('Persisted order with server price snapshots'),
      '409': response('Unavailable table or menu reference'),
    },
  },
};
for (const [suffix, method, summary] of [
  ['', 'get', 'Read order detail'],
  ['', 'put', 'Edit OPEN order; OrderInput plus version'],
  [
    '/status',
    'patch',
    'Transition order; {version, status}; void requires orders:approve; completion requires payment',
  ],
  ['/table', 'patch', 'Transfer seating; {version, tableId}'],
] as const) {
  const key = '/orders/{id}' + suffix;
  paths[key] = {
    ...(paths[key] || {}),
    [method]: {
      summary,
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
        },
      ],
      responses: {
        '200': response('Persisted order'),
        '400': response('Invalid payload'),
        '403': response('Permission denied'),
        '409': response('Version or lifecycle conflict'),
      },
    },
  };
}
const document = {
  openapi: '3.1.0',
  info: {
    title: 'Gather POS - Phase 3',
    version: '0.3.0',
    description:
      'Single restaurant. Money uses integer minor units. Configuration changes require a replica set and use transactions and optimistic versions.',
  },
  servers: [{ url: '/api/v1' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      refreshCookie: { type: 'apiKey', in: 'cookie', name: 'pos_refresh' },
    },
    schemas,
  },
  paths,
};
await writeFile(
  new URL('../../docs/openapi.json', import.meta.url),
  JSON.stringify(document, null, 2) + '\n',
);
console.log('Generated docs/openapi.json from shared validation schemas.');
