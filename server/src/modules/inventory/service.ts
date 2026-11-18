import type { ClientSession } from 'mongoose';
import { Ingredient, Recipe, StockMovement } from './models.js';
import { AppError } from '../../lib/errors.js';
export async function consumeRecipes(
  orderId: string,
  lines: { menuItemId: string; quantity: number }[],
  actorId: string,
  session: ClientSession,
) {
  const needed = new Map<string, number>();
  for (const line of lines) {
    const recipe = await Recipe.findOne({ menuItemId: line.menuItemId }).session(session);
    if (!recipe) continue; // Products without recipes are explicitly untracked.
    for (const part of recipe.components) {
      const id = String(part.ingredientId);
      const amount = (needed.get(id) || 0) + part.quantity * line.quantity;
      if (!Number.isSafeInteger(amount))
        throw new AppError(
          400,
          'QUANTITY_LIMIT',
          'Recipe consumption exceeds supported precision.',
        );
      needed.set(id, amount);
    }
  }
  for (const [ingredientId, quantity] of needed) {
    const key = `order:${orderId}:${ingredientId}`;
    if (await StockMovement.exists({ key }).session(session)) continue;
    const ingredient = await Ingredient.findOneAndUpdate(
      { _id: ingredientId, stock: { $gte: quantity } },
      { $inc: { stock: -quantity, version: 1 } },
      { session },
    );
    if (!ingredient)
      throw new AppError(409, 'INSUFFICIENT_STOCK', 'Not enough ingredients to submit this order.');
    await StockMovement.create(
      [
        {
          ingredientId,
          delta: -quantity,
          kind: 'CONSUME',
          reason: 'Order submitted to kitchen',
          actorId,
          orderId,
          key,
        },
      ],
      { session },
    );
  }
}
