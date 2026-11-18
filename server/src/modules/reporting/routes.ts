import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { Payment, CashMovement, Shift } from '../billing/models.js';
import { OrderModel } from '../orders/model.js';
import { Ingredient, StockMovement } from '../inventory/models.js';
import { AuditLog } from '../auth/models.js';
import { ConfigurationRevision, CategoryModel } from '../configuration/models.js';
import { AppError } from '../../lib/errors.js';
import { RestaurantSettings, getRestaurantSettings, settingsSchema } from './settings.js';
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
export function reportingRoutes(auth: AuthService) {
  const router = Router();
  router.use(requireAuth(auth));
  router.get('/settings', async (_req, res) => {
    res.json({ data: await getRestaurantSettings() });
  });
  router.put('/settings', requirePermission('settings:write'), async (req, res) => {
    const { version, ...fields } = settingsSchema
      .extend({ version: z.number().int().min(0) })
      .parse(req.body);
    const settings = await mongoose.connection.transaction(async (session) => {
      await ConfigurationRevision.updateOne(
        { _id: 'phase2' },
        { $inc: { revision: 1 } },
        { session },
      );
      const current = await RestaurantSettings.findById('restaurant').session(session);
      if ((current?.version || 0) !== version)
        throw new AppError(409, 'VERSION_CONFLICT', 'Settings changed; reload.');
      const saved = await RestaurantSettings.findOneAndUpdate(
        { _id: 'restaurant' },
        { $set: fields, $inc: { version: 1 } },
        { upsert: true, new: true, session },
      );
      await AuditLog.create(
        [{ actor: req.auth!.user.id, action: 'settings.updated', entityId: 'restaurant' }],
        { session },
      );
      return saved;
    });
    res.json({ data: settings });
  });
  router.get(
    ['/sales', '/dashboard'],
    (req, res, next) =>
      requirePermission(req.path === '/dashboard' ? 'dashboard:read' : 'reports:read')(
        req,
        res,
        next,
      ),
    async (req, res) => {
      const q = z.object({ from: day, to: day }).parse(req.query);
      if (q.from > q.to || Date.parse(q.to) - Date.parse(q.from) > 366 * 86400000)
        throw new AppError(400, 'DATE_RANGE', 'Choose an ordered date range of at most 367 days.');
      const settings = await getRestaurantSettings();
      const localDay = {
        $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: settings.timezone },
      };
      const match = { $expr: { $and: [{ $gte: [localDay, q.from] }, { $lte: [localDay, q.to] }] } };
      const [
        payments,
        refunds,
        orders,
        lowStock,
        hourly,
        products,
        charges,
        cashiers,
        stock,
        shifts,
        recent,
      ] = await Promise.all([
        Payment.aggregate([
          { $match: match },
          {
            $group: {
              _id: localDay,
              cashMinor: { $sum: '$amountMinor' },
              paymentCount: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        CashMovement.aggregate([
          { $match: { ...match, kind: 'REFUND' } },
          { $group: { _id: localDay, refundMinor: { $sum: '$amountMinor' } } },
          { $sort: { _id: 1 } },
        ]),
        OrderModel.aggregate([
          { $match: match },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        Ingredient.find({ $expr: { $lte: ['$stock', '$lowStock'] } })
          .sort({ name: 1 })
          .limit(50)
          .select('name unit stock lowStock')
          .lean(),
        Payment.aggregate([
          { $match: match },
          {
            $group: {
              _id: {
                $dateToString: { date: '$createdAt', format: '%H:00', timezone: settings.timezone },
              },
              cashMinor: { $sum: '$amountMinor' },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        OrderModel.aggregate([
          { $match: { status: 'COMPLETED' } },
          {
            $set: {
              createdAt: {
                $ifNull: [
                  {
                    $arrayElemAt: [
                      {
                        $map: {
                          input: {
                            $filter: {
                              input: '$history',
                              as: 'h',
                              cond: { $eq: ['$$h.status', 'COMPLETED'] },
                            },
                          },
                          as: 'h',
                          in: '$$h.at',
                        },
                      },
                      -1,
                    ],
                  },
                  '$updatedAt',
                ],
              },
            },
          },
          { $match: match },
          { $unwind: '$lines' },
          {
            $group: {
              _id: {
                id: '$lines.menuItemId',
                name: '$lines.name',
                categoryId: '$lines.categoryId',
              },
              quantity: { $sum: '$lines.quantity' },
              grossMinor: {
                $sum: {
                  $multiply: [
                    '$lines.quantity',
                    { $add: ['$lines.unitPriceMinor', { $sum: '$lines.modifiers.priceMinor' }] },
                  ],
                },
              },
            },
          },
          { $sort: { grossMinor: -1 } },
        ]),
        OrderModel.aggregate([
          { $match: { status: 'COMPLETED' } },
          {
            $set: {
              createdAt: {
                $ifNull: [
                  {
                    $arrayElemAt: [
                      {
                        $map: {
                          input: {
                            $filter: {
                              input: '$history',
                              as: 'h',
                              cond: { $eq: ['$$h.status', 'COMPLETED'] },
                            },
                          },
                          as: 'h',
                          in: '$$h.at',
                        },
                      },
                      -1,
                    ],
                  },
                  '$updatedAt',
                ],
              },
            },
          },
          { $match: match },
          {
            $group: {
              _id: null,
              completed: { $sum: 1 },
              totalMinor: { $sum: { $ifNull: ['$bill.totalMinor', '$subtotalMinor'] } },
              taxMinor: { $sum: '$bill.taxMinor' },
              discountMinor: { $sum: '$bill.discountMinor' },
              serviceMinor: { $sum: '$bill.serviceMinor' },
            },
          },
        ]),
        Payment.aggregate([
          { $match: match },
          { $group: { _id: '$actorId', cashMinor: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
          { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'staff' } },
          { $project: { cashMinor: 1, count: 1, name: { $arrayElemAt: ['$staff.name', 0] } } },
        ]),
        StockMovement.aggregate([
          { $match: match },
          {
            $group: {
              _id: { ingredient: '$ingredientId', kind: '$kind' },
              delta: { $sum: '$delta' },
              count: { $sum: 1 },
            },
          },
          {
            $lookup: {
              from: 'ingredients',
              localField: '_id.ingredient',
              foreignField: '_id',
              as: 'ingredient',
            },
          },
          {
            $project: {
              delta: 1,
              count: 1,
              name: { $arrayElemAt: ['$ingredient.name', 0] },
              unit: { $arrayElemAt: ['$ingredient.unit', 0] },
            },
          },
        ]),
        Shift.aggregate([
          { $match: { status: 'CLOSED' } },
          { $set: { createdAt: '$closedAt' } },
          { $match: match },
          { $sort: { closedAt: -1 } },
          {
            $project: {
              cashierId: 1,
              closedAt: 1,
              openingMinor: 1,
              expectedMinor: 1,
              countedMinor: 1,
              differenceMinor: 1,
            },
          },
        ]),
        Payment.find(match)
          .sort({ createdAt: -1 })
          .limit(20)
          .select('orderId amountMinor method createdAt')
          .lean(),
      ]);
      const categoryNames = await CategoryModel.find().select('name').lean();
      const categoryMap = new Map<string, { _id: string; quantity: number; grossMinor: number }>();
      for (const product of products) {
        const name =
          categoryNames.find((c) => String(c._id) === product._id.categoryId)?.name ||
          'Uncategorized legacy snapshot';
        const row = categoryMap.get(name) || { _id: name, quantity: 0, grossMinor: 0 };
        row.quantity += product.quantity;
        row.grossMinor += product.grossMinor;
        categoryMap.set(name, row);
      }
      if (req.path === '/dashboard') {
        cashiers.length = 0;
        stock.length = 0;
        shifts.length = 0;
      }
      res.json({
        data: {
          categories: [...categoryMap.values()],
          timezone: settings.timezone,
          from: q.from,
          to: q.to,
          payments,
          refunds,
          orders,
          lowStock,
          hourly,
          products,
          charges: charges[0] || {
            completed: 0,
            totalMinor: 0,
            taxMinor: 0,
            discountMinor: 0,
            serviceMinor: 0,
          },
          cashiers,
          stock,
          shifts,
          recent,
          cashMinor: payments.reduce((s, p) => s + p.cashMinor, 0),
          refundMinor: refunds.reduce((s, r) => s + r.refundMinor, 0),
        },
      });
    },
  );
  return router;
}
