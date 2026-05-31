-- Enlaza correctamente la cadena de huellas del seed demo (G2).
--
-- El seed 0002 solo encadenó los 3 registros superiores; los registros 125 y
-- 126 quedaron con huella_anterior NULL, lo que `verificarEnlace` reporta como
-- cadena rota. Aquí los enlazamos con la huella del registro previo para que la
-- verificación de integridad pase sobre los datos demo. (124 es el primero →
-- huella_anterior NULL, correcto.)

UPDATE platform_verifactu.registros
   SET huella_anterior = '12FE88A0…3B'          -- huella del registro 124
 WHERE app_id = 'verifactu'
   AND tenant_id = '11111111-1111-4111-8111-111111111111'
   AND numero = 125;

UPDATE platform_verifactu.registros
   SET huella_anterior = '55BC91D4…7E'          -- huella del registro 125
 WHERE app_id = 'verifactu'
   AND tenant_id = '11111111-1111-4111-8111-111111111111'
   AND numero = 126;
