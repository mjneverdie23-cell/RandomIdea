/**
 * Health, armour and the armour damage model.
 *
 * Kept separate from the character so a destructible prop, a vehicle or an
 * objective could reuse the exact same component later.
 */
export class Health {
  constructor({ maxHealth = 100, maxArmor = 100, armor = 0, hasHelmet = false, armorDamageFraction = 0.5, helmetHeadshotReduction = 0.4 } = {}) {
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.maxArmor = maxArmor;
    this.armor = armor;
    this.hasHelmet = hasHelmet;
    this.armorDamageFraction = armorDamageFraction;
    this.helmetHeadshotReduction = helmetHeadshotReduction;
    this.alive = true;
  }

  get isFullHealth() { return this.health >= this.maxHealth; }

  /**
   * Apply damage through the armour model.
   * @param {number} rawDamage already multiplied by range falloff / hit zone
   * @param {{armorPenetration?: number, isHeadshot?: boolean}} options
   * @returns {{healthDamage: number, armorDamage: number, died: boolean, absorbed: number}}
   */
  takeDamage(rawDamage, { armorPenetration = 1, isHeadshot = false } = {}) {
    if (!this.alive) return { healthDamage: 0, armorDamage: 0, died: false, absorbed: 0 };

    let damage = rawDamage;
    // A helmet blunts headshots specifically, on top of normal armour.
    if (isHeadshot && this.hasHelmet && this.armor > 0) {
      damage *= 1 - this.helmetHeadshotReduction;
    }

    let healthDamage = damage;
    let armorDamage = 0;
    if (this.armor > 0) {
      healthDamage = damage * armorPenetration;
      const absorbedByArmor = damage - healthDamage;
      armorDamage = Math.min(this.armor, absorbedByArmor * this.armorDamageFraction);
      // Armour that runs out mid-hit stops protecting for the remainder.
      const unprotected = Math.max(0, absorbedByArmor * this.armorDamageFraction - this.armor);
      healthDamage += unprotected / this.armorDamageFraction;
      this.armor = Math.max(0, this.armor - armorDamage);
    }

    healthDamage = Math.min(this.health, healthDamage);
    this.health -= healthDamage;
    const died = this.health <= 0;
    if (died) { this.health = 0; this.alive = false; }
    return { healthDamage, armorDamage, died, absorbed: damage - healthDamage };
  }

  heal(amount) {
    if (!this.alive) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return this.health - before;
  }

  addArmor(amount) {
    this.armor = Math.min(this.maxArmor, this.armor + amount);
  }

  kill() {
    this.health = 0;
    this.alive = false;
  }

  /** Full reset at the start of a round. */
  reset({ maxHealth = this.maxHealth, maxArmor = this.maxArmor, armor = 0, hasHelmet = false } = {}) {
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.maxArmor = maxArmor;
    this.armor = armor;
    this.hasHelmet = hasHelmet;
    this.alive = true;
  }
}
