// // utils/currencyUtils.js
// /**
//  * Utility functions for handling currency conversions
//  * All amounts stored in database are in CENTS (€1 = 100 cents)
//  */

// /**
//  * Convert euros to cents for database storage
//  * @param {number} euros - Amount in euros
//  * @returns {number} Amount in cents (rounded)
//  */
// // exports.eurosToCents = (euros) => {
//   return Math.round(parseFloat(euros || 0) * 100);
// };

// /**
//  * Convert cents to euros for display
//  * @param {number} cents - Amount in cents
//  * @returns {number} Amount in euros
//  */
// exports.centsToEuros = (cents) => {
//   return (cents || 0) / 100;
// };

// /**
//  * Format cents as currency string
//  * @param {number} cents - Amount in cents
//  * @returns {string} Formatted currency string (e.g., "€400.00")
//  */
// exports.formatCents = (cents) => {
//   const euros = this.centsToEuros(cents);
//   return new Intl.NumberFormat('en-US', {
//     style: 'currency',
//     currency: 'EUR',
//     minimumFractionDigits: 0,
//     maximumFractionDigits: 2
//   }).format(euros);
// };

// /**
//  * Format euros as currency string
//  * @param {number} euros - Amount in euros
//  * @returns {string} Formatted currency string
//  */
// exports.formatEuros = (euros) => {
//   return new Intl.NumberFormat('en-US', {
//     style: 'currency',
//     currency: 'EUR',
//     minimumFractionDigits: 0,
//     maximumFractionDigits: 2
//   }).format(euros || 0);
// };

// /**
//  * Validate and parse amount input
//  * @param {string|number} input - Amount input
//  * @param {boolean} isCents - Whether input is in cents
//  * @returns {object} { valid: boolean, amount: number, euros: number, cents: number }
//  */
// exports.parseAmount = (input, isCents = false) => {
//   try {
//     const num = parseFloat(input);
//     if (isNaN(num) || num < 0) {
//       return { valid: false, error: 'Invalid amount' };
//     }
    
//     const cents = isCents ? Math.round(num) : this.eurosToCents(num);
//     const euros = this.centsToEuros(cents);
    
//     return {
//       valid: true,
//       amount: cents,
//       euros: euros,
//       cents: cents,
//       formatted: this.formatCents(cents)
//     };
//   } catch (error) {
//     return { valid: false, error: error.message };
//   }
// };