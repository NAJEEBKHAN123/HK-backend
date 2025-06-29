const express = require("express");
const router = express.Router();
const { loginAdmin } = require("../controller/userController");

router.post("/login", loginAdmin); // POST /api/admin/login

module.exports = router;
