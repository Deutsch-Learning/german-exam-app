const normalizePaymentReference = (value) => String(value ?? "").trim().slice(0, 180);

const getOwnedPaymentTransaction = async (pool, { reference, userId }) => {
  const normalizedReference = normalizePaymentReference(reference);
  const normalizedUserId = Number(userId);
  if (!normalizedReference) return null;
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    throw new TypeError("A valid authenticated user is required to retrieve payment status.");
  }

  const result = await pool.query(
    `SELECT id, user_id, provider, provider_reference, status, amount, currency, metadata
       FROM payment_transactions
      WHERE user_id = $2
        AND (
          provider_reference = $1
          OR metadata #>> '{notchpay,merchantReference}' = $1
          OR metadata #>> '{notchpay,reference}' = $1
        )
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalizedReference, normalizedUserId]
  );
  return result.rows[0] || null;
};

module.exports = {
  getOwnedPaymentTransaction,
  normalizePaymentReference,
};
