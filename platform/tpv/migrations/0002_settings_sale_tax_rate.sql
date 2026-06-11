-- Tipo de IVA por defecto para ventas "a importe" (cobros Tap to Pay / QR que
-- no traen líneas con su propio tipo). El recibo simplificado se emite tratando
-- el importe como IVA incluido a este tipo. 21,00 = IVA general España.
ALTER TABLE platform_tpv.settings
  ADD COLUMN IF NOT EXISTS default_sale_tax_rate NUMERIC(5,2) NOT NULL DEFAULT 21.00;
