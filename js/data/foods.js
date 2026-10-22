/**
 * Base de données nutritionnelle marocaine, méditerranéenne & pâtisseries courantes au Maroc
 * - carbs100g : Glucides totaux pour 100g
 * - fiber100g : Fibres alimentaires pour 100g
 * - gi        : Index Glycémique
 * - defaultGrams : Grammage moyen d'une portion visuelle servie dans l'assiette
 */
export const MOROCCAN_FOODS = [
  // --- PÂTISSERIES, GÂTEAUX & DESSERTS ---
  { id: 'cheesecake-san-sebastian', name: 'Cheesecake San Sebastian (Gâteau Basque)', darija: 'San Sebastian / سان سيباستيان', category: 'patisseries', carbs100g: 22.5, protein100g: 6.5, fiber100g: 0.4, gi: 52, defaultGrams: 135, refPortion: '1 part triangulaire (~135g)' },
  { id: 'cheesecake-coulis', name: 'Cheesecake San Sebastian au Chocolat/Caramel', darija: 'San Sebastian chocolat / بالشكلاط', category: 'patisseries', carbs100g: 29.0, protein100g: 6.0, fiber100g: 0.8, gi: 62, defaultGrams: 150, refPortion: '1 part + nappage (~150g)' },
  { id: 'mille-feuille', name: 'Mille-feuille Pâtissier Marocain', darija: 'Mille-feuille / ميلفوي', category: 'patisseries', carbs100g: 42.0, protein100g: 4.5, fiber100g: 1.2, gi: 74, defaultGrams: 110, refPortion: '1 pièce (~110g)' },
  { id: 'tiramisu', name: 'Tiramisu Classique / Spéculoos', darija: 'Tiramisu / تيراميسو', category: 'patisseries', carbs100g: 28.5, protein100g: 4.8, fiber100g: 0.9, gi: 60, defaultGrams: 130, refPortion: '1 part / verrine (~130g)' },
  { id: 'gateau-chocolat', name: 'Fondant / Gâteau au Chocolat', darija: 'Kika b choklat / كيكة بالشكلاط', category: 'patisseries', carbs100g: 44.0, protein100g: 5.5, fiber100g: 2.5, gi: 65, defaultGrams: 110, refPortion: '1 part (~110g)' },
  { id: 'croissant-petit-pain', name: 'Croissant / Petit Pain au Chocolat (Krwasan)', darija: 'Krwasan / كرواصة أو بتي بان', category: 'patisseries', carbs100g: 46.0, protein100g: 7.5, fiber100g: 2.3, gi: 70, defaultGrams: 65, refPortion: '1 viennoiserie (~65g)' },

  // --- PAINS & GALETTES ---
  { id: 'pain-cereales', name: 'Pain aux Céréales & Graines', darija: 'Khobz zرارع / خبز الزرارع والحبوب', category: 'pains', carbs100g: 42.0, protein100g: 11.0, fiber100g: 8.2, gi: 48, defaultGrams: 65, refPortion: 'Morceau (~65g)' },
  { id: 'khobz-blanc', name: 'Khobz de boulangerie (Pain blanc)', darija: 'Khobz souk / خبز عادي', category: 'pains', carbs100g: 52.0, protein100g: 8.0, fiber100g: 2.8, gi: 75, defaultGrams: 80, refPortion: '1/3 pain (~80g)' },
  { id: 'khobz-complet', name: 'Khobz Dar Complet (Blé entier)', darija: 'Khobz zraa / خبز القمح', category: 'pains', carbs100g: 43.0, protein100g: 9.5, fiber100g: 7.5, gi: 52, defaultGrams: 80, refPortion: '1/3 pain complet (~80g)' },
  { id: 'khobz-ch3ir', name: 'Pain d’Orge (Khobz Ch3ir)', darija: 'Khobz ch3ir / خبز الشعير', category: 'pains', carbs100g: 41.0, protein100g: 9.0, fiber100g: 8.5, gi: 46, defaultGrams: 80, refPortion: '1 part (~80g)' },
  { id: 'batbout', name: 'Batbout moyen (Pain poêlé)', darija: 'Batbout / البطبوط', category: 'pains', carbs100g: 49.0, protein100g: 8.5, fiber100g: 3.2, gi: 70, defaultGrams: 90, refPortion: '1 batbout (~90g)' },
  { id: 'msemen', name: 'Msemen traditionnel', darija: 'Msemen / المسمن', category: 'pains', carbs100g: 44.0, protein100g: 7.0, fiber100g: 2.0, gi: 68, defaultGrams: 95, refPortion: '1 pièce (~95g)' },
  { id: 'meloui', name: 'Meloui feuilleté', darija: 'Meloui / الملوي', category: 'pains', carbs100g: 45.0, protein100g: 6.8, fiber100g: 2.2, gi: 68, defaultGrams: 110, refPortion: '1 pièce (~110g)' },
  { id: 'harcha', name: 'Harcha (Galette de semoule)', darija: 'Harcha / الحرشة', category: 'pains', carbs100g: 50.0, protein100g: 6.5, fiber100g: 2.5, gi: 67, defaultGrams: 90, refPortion: '1 Harcha (~90g)' },
  { id: 'baghrir', name: 'Baghrir (Crêpe mille trous)', darija: 'Baghrir / البغرير', category: 'pains', carbs100g: 43.0, protein100g: 6.0, fiber100g: 1.8, gi: 72, defaultGrams: 65, refPortion: '1 Baghrir (~65g)' },
  { id: 'krachel', name: 'Krachel / Qors (Brioche anis)', darija: 'Krachel / القراشل', category: 'pains', carbs100g: 54.0, protein100g: 8.0, fiber100g: 2.4, gi: 74, defaultGrams: 70, refPortion: '1 pièce (~70g)' },

  // --- PROTÉINES, PLATS & TAJINES ---
  { id: 'oeufs-plat', name: '2 Œufs (Au plat / Omelette / Dur)', darija: '2 Baid / جوج بيضات', category: 'plats', carbs100g: 1.1, protein100g: 13.0, fiber100g: 0.0, gi: 0, defaultGrams: 120, refPortion: '2 œufs (~120g)' },
  { id: 'jben-huile-olive', name: 'Jben Beldi & Huile d’Olive Vierge', darija: 'Jben + Zit Zitoun / جبن بلدي وزيت العود', category: 'plats', carbs100g: 2.5, protein100g: 14.0, fiber100g: 0.0, gi: 15, defaultGrams: 65, refPortion: 'Portion Jben + Huile (~65g)' },
  { id: 'huile-olive-pure', name: 'Huile d’Olive Vierge (Zit Zitoun)', darija: 'Zit Zitoun / زيت العود', category: 'plats', carbs100g: 0.0, protein100g: 0.0, fiber100g: 0.0, gi: 0, defaultGrams: 25, refPortion: '2 c. à soupe (~25g)' },
  { id: 'beurre-doux', name: 'Beurre (Pasteurisé ou Beldi)', darija: 'Zebda / زبدة', category: 'plats', carbs100g: 0.6, protein100g: 0.8, fiber100g: 0.0, gi: 0, defaultGrams: 15, refPortion: '1 noix (~15g)' },
  { id: 'olives-marocaines', name: 'Olives Marocaines (Meslalla / Rouges / Noires)', darija: 'Zitoun mcheremel / زيتون مشرمل', category: 'plats', carbs100g: 3.8, protein100g: 1.2, fiber100g: 3.2, gi: 15, defaultGrams: 50, refPortion: 'Petite coupelle (~50g)' },
  { id: 'poulet-grille', name: 'Poulet Grillé / Rôti / Mhamer', darija: 'Djaj mchwi / دجاج مشوي أو محمر', category: 'plats', carbs100g: 1.2, protein100g: 27.0, fiber100g: 0.0, gi: 0, defaultGrams: 200, refPortion: 'Filet / Cuisse (~200g)' },
  { id: 'sardines-grillees', name: 'Sardines Grillées / Au Four (Chouwaya)', darija: 'Serdine mchwi / سردين مشوي أو في الفران', category: 'plats', carbs100g: 0.8, protein100g: 24.5, fiber100g: 0.0, gi: 0, defaultGrams: 200, refPortion: 'Portion (~200g)' },
  { id: 'poisson-blanc', name: 'Poisson Grillé / Four (Merlan, Sole, Dorade, Thon)', darija: 'Hout mchwi / حوت مشوي أو في الفران', category: 'plats', carbs100g: 0.5, protein100g: 22.0, fiber100g: 0.0, gi: 0, defaultGrams: 200, refPortion: 'Filet / Poisson (~200g)' },
  { id: 'kefta-grillee', name: 'Viande Hachée (Kefta Grillée / Tajine)', darija: 'Kefta mchwiya / كفتة مشوية', category: 'plats', carbs100g: 1.8, protein100g: 23.0, fiber100g: 0.3, gi: 10, defaultGrams: 180, refPortion: 'Portion (~180g)' },
  { id: 'brochettes-viande', name: 'Viande Grillée / Brochettes (Qotban Bœuf/Dinde)', darija: 'Qotban / قطبان اللحم أو لاداند', category: 'plats', carbs100g: 0.5, protein100g: 26.0, fiber100g: 0.0, gi: 0, defaultGrams: 180, refPortion: 'Brochettes (~180g)' },
  { id: 'avocat-nature', name: 'Avocat Frais Nature (Sans sucre)', darija: 'Avocat / لافوكا طبيعية', category: 'plats', carbs100g: 8.5, protein100g: 2.0, fiber100g: 6.7, gi: 15, defaultGrams: 120, refPortion: 'Demi-avocat (~120g)' },
  { id: 'riz-cuit', name: 'Riz Cuit (Blanc ou Basmati)', darija: 'Rouz / الروز طايب', category: 'plats', carbs100g: 28.0, protein100g: 2.7, fiber100g: 0.8, gi: 64, defaultGrams: 150, refPortion: 'Portion (~150g)' },
  { id: 'frites-maison', name: 'Frites / Pommes de terre sautées', darija: 'Frit / فريت بطاطس مقلية', category: 'plats', carbs100g: 31.0, protein100g: 3.4, fiber100g: 3.0, gi: 75, defaultGrams: 120, refPortion: 'Portion (~120g)' },
  { id: 'couscous-semoule', name: 'Semoule de Couscous cuite', darija: 'Smida kusksu / الكسكس', category: 'plats', carbs100g: 23.2, protein100g: 4.2, fiber100g: 2.2, gi: 65, defaultGrams: 200, refPortion: 'Semoule (~200g)' },
  { id: 'couscous-belboula', name: 'Couscous Belboula d’Orge', darija: 'Belboula / بلبولة الشعير', category: 'plats', carbs100g: 18.0, protein100g: 4.0, fiber100g: 4.6, gi: 47, defaultGrams: 200, refPortion: 'Belboula (~200g)' },
  { id: 'legumes-couscous', name: 'Légumes de Couscous & Bouillon', darija: 'Khodra / خضر الكسكس', category: 'plats', carbs100g: 7.5, protein100g: 1.8, fiber100g: 2.8, gi: 45, defaultGrams: 160, refPortion: 'Louche légumes (~160g)' },
  { id: 'tfaya', name: 'Tfaya (Oignons & raisins caramélisés)', darija: 'Tfaya / التفاية', category: 'plats', carbs100g: 38.0, protein100g: 2.0, fiber100g: 3.1, gi: 74, defaultGrams: 75, refPortion: '2 c. à soupe (~75g)' },
  { id: 'tajine-poulet-olives', name: 'Tajine Poulet Citron & Olives', darija: 'Tajine djaj / طاجين الدجاج', category: 'plats', carbs100g: 3.5, protein100g: 16.5, fiber100g: 0.9, gi: 25, defaultGrams: 220, refPortion: 'Poulet + sauce (~220g)' },
  { id: 'tajine-kefta', name: 'Tajine Kefta Tomates & Œufs', darija: 'Tajine kefta / طاجين الكفتة', category: 'plats', carbs100g: 4.2, protein100g: 15.0, fiber100g: 1.1, gi: 30, defaultGrams: 220, refPortion: 'Kefta + sauce (~220g)' },
  { id: 'tajine-pruneaux', name: 'Tajine Viande aux Pruneaux', darija: 'Lham bel barqouq / اللحم بالبرقوق', category: 'plats', carbs100g: 15.0, protein100g: 17.5, fiber100g: 2.4, gi: 62, defaultGrams: 240, refPortion: 'Viande + pruneaux (~240g)' },
  { id: 'pommes-terre-tajine', name: 'Pommes de terre & Carottes (Tajine)', darija: 'Batata / بطاطس وخيزو', category: 'plats', carbs100g: 15.5, protein100g: 2.1, fiber100g: 2.3, gi: 65, defaultGrams: 140, refPortion: 'Garniture (~140g)' },
  { id: 'rfissa', name: 'Rfissa au Poulet & Lentilles', darija: 'Rfissa / الرفيسة', category: 'plats', carbs100g: 26.0, protein100g: 12.0, fiber100g: 3.4, gi: 64, defaultGrams: 300, refPortion: 'Assiette (~300g)' },
  { id: 'pastilla-poulet', name: 'Pastilla Poulet & Amandes', darija: 'Bastila djaj / بسطيلة الدجاج', category: 'plats', carbs100g: 28.0, protein100g: 14.5, fiber100g: 2.1, gi: 66, defaultGrams: 180, refPortion: '1 part (~180g)' },
  { id: 'pastilla-poisson', name: 'Pastilla Poisson & Vermicelles', darija: 'Bastila hout / بسطيلة الحوت', category: 'plats', carbs100g: 19.0, protein100g: 13.5, fiber100g: 1.2, gi: 60, defaultGrams: 190, refPortion: '1 part (~190g)' },
  { id: 'seffa', name: 'Seffa Medfouna (Vermicelles)', darija: 'Seffa / السفة', category: 'plats', carbs100g: 32.0, protein100g: 6.0, fiber100g: 1.8, gi: 73, defaultGrams: 220, refPortion: 'Portion (~220g)' },
  { id: 'zaalouk', name: 'Zaalouk d’Aubergines', darija: 'Zaalouk / زعلوك', category: 'plats', carbs100g: 5.5, protein100g: 1.5, fiber100g: 2.8, gi: 25, defaultGrams: 120, refPortion: 'Coupelle (~120g)' },
  { id: 'taktouka', name: 'Taktouka Poivrons & Tomates', darija: 'Taktouka / التكتوكة', category: 'plats', carbs100g: 5.0, protein100g: 1.4, fiber100g: 1.9, gi: 25, defaultGrams: 120, refPortion: 'Coupelle (~120g)' },
  { id: 'salade-marocaine', name: 'Salade Marocaine (Tomates, Oignons, Concombre)', darija: 'Chlada / شلاظة مغربية', category: 'plats', carbs100g: 4.2, protein100g: 1.2, fiber100g: 1.5, gi: 20, defaultGrams: 150, refPortion: 'Assiette (~150g)' },
  { id: 'briouate-salee', name: 'Briouates salées (Kefta/Fromage)', darija: 'Briouates / بريوات مالحين', category: 'plats', carbs100g: 24.0, protein100g: 11.0, fiber100g: 1.4, gi: 62, defaultGrams: 80, refPortion: '2 pièces (~80g)' },
  { id: 'tacos-marocain', name: 'Tacos Marocain / Panini Frites', darija: 'Tacos / طاكوس', category: 'plats', carbs100g: 31.0, protein100g: 13.5, fiber100g: 2.2, gi: 72, defaultGrams: 300, refPortion: '1 Tacos (~300g)' },
  { id: 'pizza-part', name: 'Pizza (Part moyenne)', darija: 'Pizza / بيتزا', category: 'plats', carbs100g: 33.0, protein100g: 11.0, fiber100g: 2.0, gi: 70, defaultGrams: 130, refPortion: '1 part (~130g)' },

  // --- LÉGUMINEUSES & SOUPES ---
  { id: 'harira', name: 'Harira Marocaine Traditionnelle', darija: 'Harira / الحريرة', category: 'legumineuses', carbs100g: 9.2, protein100g: 4.8, fiber100g: 1.8, gi: 56, defaultGrams: 300, refPortion: '1 bol (~300ml)' },
  { id: 'loubia', name: 'Loubia (Haricots blancs en sauce)', darija: 'Loubia / اللوبيا', category: 'legumineuses', carbs100g: 16.5, protein100g: 8.5, fiber100g: 5.5, gi: 38, defaultGrams: 260, refPortion: 'Assiette (~260g)' },
  { id: 'adass', name: 'Adass (Lentilles mijotées)', darija: '3dass / العدس', category: 'legumineuses', carbs100g: 15.8, protein100g: 9.2, fiber100g: 5.2, gi: 32, defaultGrams: 260, refPortion: 'Assiette (~260g)' },
  { id: 'bissara', name: 'Bissara (Velouté de fèves)', darija: 'Bissara / البيصارة', category: 'legumineuses', carbs100g: 14.2, protein100g: 8.0, fiber100g: 4.4, gi: 48, defaultGrams: 280, refPortion: '1 bol (~280g)' },
  { id: 'hssa', name: 'Hssa / Soupe d’Orge au lait', darija: 'Hssa / حسوة الشعير', category: 'legumineuses', carbs100g: 8.5, protein100g: 3.5, fiber100g: 1.9, gi: 45, defaultGrams: 280, refPortion: '1 bol (~280ml)' },

  // --- FRUITS & DOUCEURS ---
  { id: 'datte-majhoul', name: 'Dattes Majhoul Royales', darija: 'Tmar Majhoul / تمر المجهول', category: 'fruits', carbs100g: 75.0, protein100g: 2.2, fiber100g: 6.7, gi: 55, defaultGrams: 24, refPortion: '1 grosse datte (~24g)' },
  { id: 'dattes-courantes', name: 'Dattes courantes (3 unités)', darija: 'Tmar / التمر', category: 'fruits', carbs100g: 73.0, protein100g: 2.4, fiber100g: 7.0, gi: 54, defaultGrams: 27, refPortion: '3 dattes (~27g)' },
  { id: 'chebakia', name: 'Chebakia au Miel & Sésame', darija: 'Chebakia / الشباكية', category: 'fruits', carbs100g: 62.0, protein100g: 6.5, fiber100g: 3.0, gi: 78, defaultGrams: 35, refPortion: '1 pièce (~35g)' },
  { id: 'sellou', name: 'Sellou / Sfouf traditionnel', darija: 'Sellou / سلو', category: 'fruits', carbs100g: 42.0, protein100g: 10.5, fiber100g: 6.5, gi: 58, defaultGrams: 40, refPortion: '2 c. à soupe (~40g)' },
  { id: 'corne-gazelle', name: 'Corne de Gazelle (Kaab Ghzal)', darija: 'Kaab ghzal / كعب غزال', category: 'fruits', carbs100g: 48.0, protein100g: 8.5, fiber100g: 4.5, gi: 56, defaultGrams: 30, refPortion: '1 pièce (~30g)' },
  { id: 'miel-beurre', name: 'Miel ou Amlou', darija: '3ssel / العسل أو أملو', category: 'fruits', carbs100g: 76.0, protein100g: 0.4, fiber100g: 0.5, gi: 75, defaultGrams: 20, refPortion: '1 c. à soupe (~20g)' },
  { id: 'figues-fraiches', name: 'Figues fraîches (Karmous)', darija: 'Karmous / الكرموس', category: 'fruits', carbs100g: 16.0, protein100g: 0.8, fiber100g: 2.9, gi: 50, defaultGrams: 100, refPortion: '2 figues (~100g)' },
  { id: 'hendiya', name: 'Figue de Barbarie (Hendiya)', darija: 'Hendiya / الهندية', category: 'fruits', carbs100g: 9.6, protein100g: 0.7, fiber100g: 3.6, gi: 35, defaultGrams: 150, refPortion: '2 pièces (~150g)' },

  // --- BOISSONS ---
  { id: 'atay-sucre', name: 'Thé Marocain à la Menthe Sucré', darija: 'Atay / أتاي حلو', category: 'boissons', carbs100g: 7.5, protein100g: 0.1, fiber100g: 0.0, gi: 80, defaultGrams: 150, refPortion: '1 verre (~150ml)' },
  { id: 'atay-mesouss', name: 'Thé Marocain Sans Sucre', darija: 'Atay mesouss / أتاي مسوس', category: 'boissons', carbs100g: 0.0, protein100g: 0.1, fiber100g: 0.0, gi: 0, defaultGrams: 150, refPortion: '1 verre (~150ml)' },
  { id: 'jus-orange', name: 'Jus d’Orange Frais Pressé', darija: '3assir limoun / عصير البرتقال', category: 'boissons', carbs100g: 10.4, protein100g: 0.7, fiber100g: 0.2, gi: 66, defaultGrams: 220, refPortion: '1 verre (~220ml)' },
  { id: 'jus-avocat', name: 'Jus d’Avocat au Lait Sucré', darija: '3assir avocat / عصير لافوكا', category: 'boissons', carbs100g: 13.5, protein100g: 3.2, fiber100g: 2.2, gi: 58, defaultGrams: 250, refPortion: '1 grand verre (~250ml)' },
  { id: 'lben', name: 'Lben (Babeurre fermenté)', darija: 'Lben / اللبن', category: 'boissons', carbs100g: 4.0, protein100g: 3.3, fiber100g: 0.0, gi: 32, defaultGrams: 200, refPortion: '1 verre (~200ml)' }
];

export const PRESET_PLATES = {
  jeune_10h: {
    title: '🍳 Repas 10h (18/6) : 2 Œufs, Pain Céréales, Jben & Huile d’Olive',
    items: [
      { foodId: 'oeufs-plat', grams: 120, x: 35, y: 45 },
      { foodId: 'pain-cereales', grams: 65, x: 68, y: 55 },
      { foodId: 'jben-huile-olive', grams: 65, x: 45, y: 72 }
    ]
  },
  jeune_15h_poulet: {
    title: '🍗 Repas 15h (18/6) : Poulet Grillé, Salade & Morceau de Khobz',
    items: [
      { foodId: 'poulet-grille', grams: 200, x: 42, y: 45 },
      { foodId: 'salade-marocaine', grams: 140, x: 66, y: 38 },
      { foodId: 'khobz-complet', grams: 70, x: 28, y: 72 }
    ]
  },
  jeune_15h_sardine: {
    title: '🐟 Repas 15h (18/6) : Sardines Grillées, Salade & Morceau de Khobz',
    items: [
      { foodId: 'sardines-grillees', grams: 200, x: 42, y: 45 },
      { foodId: 'salade-marocaine', grams: 140, x: 66, y: 38 },
      { foodId: 'khobz-complet', grams: 70, x: 28, y: 72 }
    ]
  },
  jeune_15h_kefta: {
    title: '🥩 Repas 15h (18/6) : Viande Hachée (Kefta), Salade & Morceau de Khobz',
    items: [
      { foodId: 'kefta-grillee', grams: 180, x: 42, y: 45 },
      { foodId: 'salade-marocaine', grams: 140, x: 66, y: 38 },
      { foodId: 'khobz-complet', grams: 70, x: 28, y: 72 }
    ]
  },
  san_sebastian: {
    title: '🍰 Gâteau Cheesecake San Sebastian (1 part)',
    items: [
      { foodId: 'cheesecake-san-sebastian', grams: 135, x: 50, y: 50 }
    ]
  },
  tajine_khobz: {
    title: '🥘 Tajine Poulet/Légumes & Khobz Blanc',
    items: [
      { foodId: 'tajine-poulet-olives', grams: 220, x: 40, y: 46 },
      { foodId: 'pommes-terre-tajine', grams: 135, x: 64, y: 58 },
      { foodId: 'khobz-blanc', grams: 90, x: 26, y: 74 }
    ]
  },
  couscous_royal: {
    title: '🍲 Assiette de Couscous aux 7 Légumes & Lben',
    items: [
      { foodId: 'couscous-semoule', grams: 220, x: 46, y: 56 },
      { foodId: 'legumes-couscous', grams: 160, x: 50, y: 34 },
      { foodId: 'lben', grams: 200, x: 78, y: 26 }
    ]
  },
  ftour_marocain: {
    title: '🥞 Msemen, Baghrir au Miel & Verre d’Atay',
    items: [
      { foodId: 'msemen', grams: 95, x: 30, y: 56 },
      { foodId: 'baghrir', grams: 65, x: 65, y: 60 },
      { foodId: 'miel-beurre', grams: 15, x: 48, y: 44 },
      { foodId: 'atay-sucre', grams: 150, x: 75, y: 26 }
    ]
  },
  harira_chebakia: {
    title: '🥣 Ftour : Bol de Harira, Chebakia & Datte Majhoul',
    items: [
      { foodId: 'harira', grams: 300, x: 36, y: 52 },
      { foodId: 'chebakia', grams: 35, x: 72, y: 62 },
      { foodId: 'datte-majhoul', grams: 24, x: 68, y: 30 }
    ]
  }
};

export const FoodRepository = {
  getAllFoods() {
    return MOROCCAN_FOODS;
  },
  getFoodById(id) {
    return MOROCCAN_FOODS.find(f => f.id === id) || null;
  },
  getPlates() {
    return PRESET_PLATES;
  },
  getPlateByKey(key) {
    return PRESET_PLATES[key] || null;
  }
};
