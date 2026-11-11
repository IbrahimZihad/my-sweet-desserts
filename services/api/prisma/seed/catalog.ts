import type { PrismaClient } from "@prisma/client";

interface SeedCake {
  slug: string;
  name: string;
  flavour: string;
  sizeLabel: string;
  servings: number;
  priceCents: number;
  description: string;
  allergens: string[];
}

export const CAKES: SeedCake[] = [
  {
    slug: "vanilla-bean-30cm",
    name: "Vanilla Bean Celebration",
    flavour: "Madagascan vanilla",
    sizeLabel: "30cm",
    servings: 24,
    priceCents: 18_000,
    description: "Layers of vanilla sponge, vanilla bean buttercream and a white chocolate drip.",
    allergens: ["gluten", "dairy", "egg"],
  },
  {
    slug: "dark-chocolate-25cm",
    name: "Dark Chocolate Ganache",
    flavour: "70% dark chocolate",
    sizeLabel: "25cm",
    servings: 16,
    priceCents: 15_500,
    description: "Rich cocoa sponge with whipped dark chocolate ganache.",
    allergens: ["gluten", "dairy", "egg"],
  },
  {
    slug: "lemon-curd-20cm",
    name: "Lemon Curd Layer",
    flavour: "Lemon & elderflower",
    sizeLabel: "20cm",
    servings: 10,
    priceCents: 12_000,
    description: "Bright lemon curd, elderflower cream and a light citrus glaze.",
    allergens: ["gluten", "dairy", "egg"],
  },
];

export async function seedCakes(prisma: PrismaClient, bakeryId: string): Promise<number> {
  for (const [index, cake] of CAKES.entries()) {
    await prisma.cake.upsert({
      where: { bakeryId_slug: { bakeryId, slug: cake.slug } },
      update: {
        name: cake.name,
        flavour: cake.flavour,
        sizeLabel: cake.sizeLabel,
        servings: cake.servings,
        priceCents: cake.priceCents,
        description: cake.description,
        allergens: cake.allergens,
        sortOrder: index,
        isActive: true,
      },
      create: {
        bakeryId,
        slug: cake.slug,
        name: cake.name,
        flavour: cake.flavour,
        sizeLabel: cake.sizeLabel,
        servings: cake.servings,
        priceCents: cake.priceCents,
        description: cake.description,
        allergens: cake.allergens,
        sortOrder: index,
      },
    });
  }

  return CAKES.length;
}
