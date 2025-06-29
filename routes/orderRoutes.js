const express = require("express");
const router = express.Router();
const {
  createOrder,
  getOrder,
  getAllOrders,
  updateOrder,
} = require("../controller/orderController");

router.post("/", createOrder);          // Create order
router.get("/:id", getOrder);           // Get single order by ID
router.get("/", getAllOrders);          // Get all orders
router.put("/:id", updateOrder);        // ✅ Update order by ID

module.exports = router;
