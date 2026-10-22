/**
 * Types TypeScript pour GlucoScan Maroc (Production)
 */

export type UserMode = 'sport' | 'insulin' | 'wellness';
export type MealSlot = 'morning' | 'noon' | 'evening' | 'matin' | 'midi' | 'soir' | 'collation';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  userMode: UserMode;
  targetCarbsG: number;
  targetProteinsG: number;
  ratioMorning: number;
  ratioNoon: number;
  ratioEvening: number;
  fsiSensitivity: number;
  targetGlycemia: number;
  fastingStartHour: number;
  fastingEndHour: number;
  dailyScansCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MealItem {
  foodId: string;
  customName: string;
  grams: number;
  carbs100g: number;
  protein100g: number;
  fiber100g: number;
  gi: number;
  x: number;
  y: number;
  portionWarning?: string;
}

export interface MealRecord {
  id: string;
  userId: string;
  mealTime: MealSlot;
  title: string;
  portionTotalWeightG: number;
  netCarbsG: number;
  proteinsG: number;
  fibersG: number;
  fatG: number;
  glycemicIndexAvg: number;
  glycemicLoad: number;
  glycemicBufferRatio: number;
  glycemiaBefore?: number;
  bolusCalculated?: number;
  bolusInjected?: number;
  items: MealItem[];
  imageUrl?: string;
  createdAt: string;
}

export interface MoroccanFoodRef {
  id: string;
  nameFr: string;
  nameAr?: string;
  category: 'pains' | 'plats' | 'feculents' | 'sucres' | 'proteines' | 'boissons' | 'legumes' | 'patisseries' | 'legumineuses' | 'fruits';
  carbs100g: number;
  protein100g: number;
  fiber100g: number;
  fat100g: number;
  glycemicIndex: number;
  defaultPortionG: number;
  maxSafePortionG: number;
  portionUnit: string;
}

export interface GlycemicBufferEvaluation {
  ratio: number;
  status: 'optimal' | 'moderate' | 'risk';
  badgeText: string;
  badgeClass: string;
  barColor: string;
  percent: number;
  headline: string;
  description: string;
}

export interface DailyTotals {
  date: string;
  totalNetCarbs: number;
  totalProtein: number;
  mealCount: number;
  percentCarbs: number;
  percentProtein: number;
  remainingCarbs: number;
  remainingProtein: number;
}
