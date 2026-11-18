import { Router } from 'express';
import type { EventEmitter } from 'node:events';
import mongoose from 'mongoose';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { Ingredient, Recipe, StockMovement, Supplier, PurchaseOrder } from './models.js';
import { finishPurchase } from './purchasing.js';
import { ConfigurationRevision, MenuItemModel } from '../configuration/models.js';
import { AuditLog } from '../auth/models.js';
import { AppError } from '../../lib/errors.js';
const id = z.string().regex(/^[a-f\d]{24}$/i);
const quantity = z.number().int().min(0).max(1_000_000_000);
export function inventoryRoutes(auth: AuthService, events: EventEmitter) {
  const router = Router();
  router.use(requireAuth(auth));
  router.use((req, res, next) => {
    res.on('finish', () => {
      if (req.method !== 'GET' && res.statusCode < 300) events.emit('inventory:changed');
    });
    next();
  });
  router.get('/suppliers', requirePermission('inventory:read'), async (req, res) => {
    const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
    res.json({
      data: {
        items: await Supplier.find()
          .sort({ name: 1, _id: 1 })
          .skip((page - 1) * 50)
          .limit(50),
        pagination: { page, total: await Supplier.countDocuments(), limit: 50 },
      },
    });
  });
  router.post('/suppliers', requirePermission('inventory:write'), async (req, res) => {
    const fields = z
      .object({ name: z.string().trim().min(1).max(80), contact: z.string().trim().max(200) })
      .strict()
      .parse(req.body);
    const supplier = await mongoose.connection.transaction(async (session) => {
      const [record] = await Supplier.create([fields], { session });
      await AuditLog.create(
        [{ actor: req.auth!.user.id, action: 'supplier.created', entityId: record.id }],
        { session },
      );
      return record;
    });
    res.status(201).json({ data: supplier });
  });
  router.get('/purchases', requirePermission('inventory:read'), async (req, res) => {
    const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
    res.json({
      data: {
        items: await PurchaseOrder.find()
          .sort({ createdAt: -1, _id: 1 })
          .skip((page - 1) * 50)
          .limit(50),
        pagination: { page, total: await PurchaseOrder.countDocuments(), limit: 50 },
      },
    });
  });
  router.post('/purchases', requirePermission('inventory:write'), async (req, res) => {
    const fields = z
      .object({
        supplierId: id,
        lines: z
          .array(z.object({ ingredientId: id, quantity: quantity.refine((n) => n > 0) }).strict())
          .min(1)
          .max(50)
          .refine((lines) => new Set(lines.map((l) => l.ingredientId)).size === lines.length),
      })
      .strict()
      .parse(req.body);
    const purchase = await mongoose.connection.transaction(async (session) => {
      await ConfigurationRevision.updateOne(
        { _id: 'phase2' },
        { $inc: { revision: 1 } },
        { session },
      );
      if (!(await Supplier.exists({ _id: fields.supplierId }).session(session)))
        throw new AppError(400, 'INVALID_REFERENCE', 'Supplier not found.');
      if (
        (await Ingredient.countDocuments({
          _id: { $in: fields.lines.map((l) => l.ingredientId) },
        }).session(session)) !== fields.lines.length
      )
        throw new AppError(400, 'INVALID_REFERENCE', 'Ingredient not found.');
      const [order] = await PurchaseOrder.create([fields], { session });
      await AuditLog.create(
        [{ actor: req.auth!.user.id, action: 'purchase.created', entityId: order.id }],
        { session },
      );
      return order;
    });
    res.status(201).json({ data: purchase });
  });
  router.patch('/purchases/:id', requirePermission('inventory:write'), async (req, res) => {
    res.json({ data: await finishPurchase(String(req.params.id), req.body, req.auth!.user.id) });
  });
  for (const [path, model] of [
    ['ingredients', Ingredient],
    ['recipes', Recipe],
    ['movements', StockMovement],
  ] as const)
    router.get(`/${path}`, requirePermission('inventory:read'), async (req, res) => {
      const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
      const collection = model as typeof Ingredient;
      const [items, total] = await Promise.all([
        collection
          .find()
          .sort({ createdAt: -1, _id: 1 })
          .skip((page - 1) * 50)
          .limit(50),
        collection.countDocuments(),
      ]);
      res.json({ data: { items, pagination: { page, total, limit: 50 } } });
    });
  router.post('/ingredients', requirePermission('inventory:write'), async (req, res) => {
    const fields = z
      .object({
        name: z.string().trim().min(1).max(80),
        unit: z.enum(['g', 'ml', 'each']),
        lowStock: quantity,
      })
      .strict()
      .parse(req.body);
    const result = await mongoose.connection.transaction(async (session) => {
      await ConfigurationRevision.updateOne(
        { _id: 'phase2' },
        { $inc: { revision: 1 } },
        { session },
      );
      const nameKey = fields.name.normalize('NFKC').toLowerCase();
      if (await Ingredient.exists({ nameKey }).session(session))
        throw new AppError(409, 'DUPLICATE', 'Ingredient name already exists.');
      const [ingredient] = await Ingredient.create([{ ...fields, nameKey }], { session });
      await AuditLog.create(
        [{ actor: req.auth!.user.id, action: 'ingredient.created', entityId: ingredient.id }],
        { session },
      );
      return ingredient;
    });
    res.status(201).json({ data: result });
  });
  router.put('/recipes/:id', requirePermission('inventory:write'), async (req, res) => {
    const menuItemId = id.parse(req.params.id);
    const fields = z
      .object({
        version: z.number().int().min(0).nullable(),
        components: z
          .array(z.object({ ingredientId: id, quantity: quantity.refine((n) => n > 0) }).strict())
          .min(1)
          .max(50)
          .refine((parts) => new Set(parts.map((p) => p.ingredientId)).size === parts.length),
      })
      .strict()
      .parse(req.body);
    const result = await mongoose.connection.transaction(async (session) => {
      await ConfigurationRevision.updateOne(
        { _id: 'phase2' },
        { $inc: { revision: 1 } },
        { session },
      );
      if (!(await MenuItemModel.exists({ _id: menuItemId, archivedAt: null }).session(session)))
        throw new AppError(404, 'NOT_FOUND', 'Menu item not found.');
      if (
        (await Ingredient.countDocuments({
          _id: { $in: fields.components.map((p) => p.ingredientId) },
        }).session(session)) !== fields.components.length
      )
        throw new AppError(400, 'INVALID_REFERENCE', 'An ingredient does not exist.');
      const recipe = await Recipe.findOne({ menuItemId }).session(session);
      if ((recipe?.version ?? null) !== fields.version)
        throw new AppError(409, 'VERSION_CONFLICT', 'Recipe changed; reload it.');
      const saved = recipe || new Recipe({ menuItemId });
      saved.set({ components: fields.components, version: recipe ? recipe.version + 1 : 0 });
      await saved.save({ session });
      await AuditLog.create(
        [{ actor: req.auth!.user.id, action: 'recipe.saved', entityId: saved.id }],
        { session },
      );
      return saved;
    });
    res.json({ data: result });
  });
  router.post('/movements', requirePermission('inventory:write'), async (req, res) => {
    const fields = z
      .object({
        ingredientId: id,
        version: z.number().int().min(0),
        kind: z.enum(['RECEIVE', 'ADJUST', 'WASTE']),
        delta: z
          .number()
          .int()
          .min(-1_000_000_000)
          .max(1_000_000_000)
          .refine((n) => n !== 0),
        reason: z.string().trim().min(3).max(300),
        key: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    if (
      (fields.kind === 'RECEIVE' && fields.delta < 0) ||
      (fields.kind === 'WASTE' && fields.delta > 0)
    )
      throw new AppError(400, 'INVALID_QUANTITY', 'Receiving adds stock; waste removes stock.');
    const result = await mongoose.connection.transaction(async (session) => {
      await ConfigurationRevision.updateOne(
        { _id: 'phase2' },
        { $inc: { revision: 1 } },
        { session },
      );
      const prior = await StockMovement.findOne({ key: fields.key }).session(session);
      if (prior) {
        if (
          String(prior.ingredientId) !== fields.ingredientId ||
          prior.delta !== fields.delta ||
          prior.kind !== fields.kind ||
          prior.reason !== fields.reason ||
          String(prior.actorId) !== req.auth!.user.id
        )
          throw new AppError(409, 'KEY_CONFLICT', 'Key belongs to another stock movement.');
        return prior;
      }
      const ingredient = await Ingredient.findById(fields.ingredientId).session(session);
      if (!ingredient || ingredient.version !== fields.version)
        throw new AppError(409, 'VERSION_CONFLICT', 'Ingredient changed; reload it.');
      const stock = ingredient.stock + fields.delta;
      if (stock < 0 || stock > 1_000_000_000)
        throw new AppError(409, 'STOCK_LIMIT', 'Stock would exceed supported limits.');
      ingredient.stock = stock;
      ingredient.version += 1;
      await ingredient.save({ session });
      const [movement] = await StockMovement.create([{ ...fields, actorId: req.auth!.user.id }], {
        session,
      });
      await AuditLog.create(
        [
          {
            actor: req.auth!.user.id,
            action: `stock.${fields.kind.toLowerCase()}`,
            entityId: movement.id,
          },
        ],
        { session },
      );
      return movement;
    });
    res.status(201).json({ data: result });
  });
  return router;
}
