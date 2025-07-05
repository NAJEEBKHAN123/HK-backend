const express = require('express');
const router = express.Router();
const {
  createOrder,
  getOrder,
  getAllOrders,
  updateOrder,
  deleteOrder
} = require('../controller/orderController');

router.post('/', createOrder);
router.get('/', getAllOrders);
router.get('/:id', getOrder);
router.patch('/:id', updateOrder); // Using PATCH for partial updates
router.delete('/:id', deleteOrder);

module.exports = router;