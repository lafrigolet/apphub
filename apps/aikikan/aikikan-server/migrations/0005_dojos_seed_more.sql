-- El seed inicial de dojos (0004_dojos.sql) solo incluyó los 6
-- primeros del data/dojos.js original. Esta migración añade los 39
-- restantes que faltaban en el listado público. Usa gen_random_uuid()
-- — no son items idempotent-by-id, así que se siembran solo si la
-- tabla aún no tiene un dojo con ese mismo (name, city) (heurística
-- razonable: no hay dos dojos con mismo nombre y ciudad).

DO $$
DECLARE
  v_app_id    TEXT  := 'aikikan';
  v_tenant_id UUID  := '30000000-0000-0000-0000-000000000001';
  v_pos       INT   := COALESCE((SELECT MAX(position) FROM app_aikikan.dojos), 0);
  rec         RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('Gimnasio Acero Sport',          'Albacete',              'Albacete',     'Calle Juan de Toledo, 27, 02005',                                'Antonio Flores',                              '620 241 547', 'antonio@antonioflores.org',         NULL),
      ('Ciudad Real Take',              'Ciudad Real',           'Ciudad Real',  'Avda. de los Reyes Católicos, 94, 13005',                        'José Rafael Niño Selas',                      '607 577 351', 'nioselas@yahoo.es',                  NULL),
      ('Kamikwai',                      'Madrid',                'Madrid',       'C/ Amos de Escalante 17, Gimnasio KIOFU, 28017',                 'Marco Rende',                                 '655 862 641', 'info@kamikwai.org',                  NULL),
      ('Gimnasio Fénix',                'Astorga',               'León',         'C/ Enfermeras Mártires de Somiedo, 5, 24700',                    'Evelin Perrotin',                             '987 617 770', 'evelyneps54@hotmail.com',            NULL),
      ('Club Kyoto',                    'León',                  'León',         'C/ Virgen Blanca, 12, 24006',                                    'Manuel Ángel González',                       '987 212 529',  NULL,                                'clubkyoto.blogspot.com'),
      ('Musubi Elda',                   'Elda',                  'Alicante',     'C/ Hernán Cortés 20, 03600',                                     'Juan Carlos Nortes',                          '650 374 037', 'musubinaranja@gmail.com',           'aikidoelda.es'),
      ('Escuela Aikido Pinto',          'Pinto',                 'Madrid',       'C/ Asturias s/n, 28320',                                         'Pedro Maroto',                                '916 923 321', 'pedro@aikidopinto.net',             'aikidopinto.net'),
      ('Club Deportivo Las Viñas',      'Teruel',                'Teruel',       'Camino Capuchinos s/n, 44003',                                   'Daniel Campos Calandín',                      '978 617 115', 'dani_dcc@yahoo.es',                  NULL),
      ('Sangenkan Dojo',                'Torrejón de Ardoz',     'Madrid',       'Travesía de la Cañada 8, Local 5, 28850',                        'Sergio Torres',                               '672 368 699', 'sergiotorres71@gmail.com',          'sangenkan.com'),
      ('Gimnasio Emperatriz',           'Madrid',                'Madrid',       'C/ Carabanchel Alto, 16, 28044',                                 'Aurelio Pérez Argudo',                        '669 532 362', 'aurelio_aikido@hotmail.com',        'aikidocarabanchel.es'),
      ('Club Aikido Paracuellos',       'Paracuellos del Jarama','Madrid',       'C/ Extremadura S/N, 28860',                                      'José Gómez Miguel',                            NULL,         'aikido@clubaikidoparacuellos.es',   'clubaikidoparacuellos.es'),
      ('Aikido Cobeña',                 'Cobeña',                'Madrid',       'C/ de la Fuente s/n, 28863',                                     'Raúl Merino Sainz',                           '636 818 768', 'yamehabeisvisto@yahoo.es',           NULL),
      ('Araiki',                        'Miguelturra',           'Ciudad Real',  'Estadio Municipal - Paseo Castilla La Mancha s/n, 13170',        'Elías Carrión',                               '607 547 785', 'eliascm@gmail.com',                 'aikidocr.es'),
      ('Dojo Enso',                     'Granada',               'Granada',      'C/ Albuñol 3, Bajo, 18006',                                      'Ángel Montero',                               '649 642 348', 'montepeso@hotmail.com',              NULL),
      ('Gimnasio V&M',                  'Vitoria-Gasteiz',       'Álava',        'Andalucía Kalea, 1, 01003',                                      'Enrique Villarreal',                          '945 778 265',  NULL,                                'gymvm.com'),
      ('Dojo Aikido Albacete',          'Albacete',              'Albacete',     'C/ Pedro Coca 63, 02005',                                        'Venancio Ortíz',                              '663 372 967', 'aikidoalbacete@hotmail.com',         NULL),
      ('Aikido Hazumi Daganzo',         'Daganzo',               'Madrid',       'Pabellón Municipal de Daganzo, C/ Don Quijote de la Mancha s/n, 28814', 'Guillermo Valero',                       '667 466 612',  NULL,                                NULL),
      ('Centro de Tecnificación',       'Alicante',              'Alicante',     'Pabellón Pedro Ferrándiz, C/ Foguerer Gilabert Davó s/n, 03005', 'Rafael Sirvent Carbonell',                    '696 490 616',  NULL,                                NULL),
      ('Gimnasio Victoria',             'León',                  'León',         'C/ Sampiro 22, 24001',                                           'Saturnino Álvarez',                           '987 238 847',  NULL,                                'centrovictoria.com'),
      ('Gimnasio Tsukuri',              'Madrid',                'Madrid',       'C/ Hermandad Donantes de Sangre, 28021',                         'Andrés Caro',                                 '915 216 491', 'calbalakrab@gmail.com',             'desdeldojo.blogspot.com'),
      ('Isumaeru Aikido Dojo',          'Fuenlabrada',           'Madrid',       'C/ Luis Sauquillo 80, Local F, 28944',                           'Ismael Díaz',                                 '679 479 268', 'bushydo@gmail.com',                 'aikidomadridsur.es'),
      ('Escuela Lung Tao',              'Castellón de la Plana', 'Castellón',    'Cronista Muntaner, 2, 12006',                                    'Félix Rodríguez Pérez',                       '647 761 898',  NULL,                                NULL),
      ('Distrito 10',                   'Castellón de la Plana', 'Castellón',    'Alcalde Tárrega, 30, 12004',                                     'Tomás Pastor',                                 NULL,          NULL,                                NULL),
      ('Centro Mushin',                 'Parla',                 'Madrid',       'C/ María Cristina, 29, 28983',                                   'Ivan Arroyo',                                 '636 326 398', 'info@centromushin.es',              'centromushin.es'),
      ('Amanecer',                      'Alcorcón',              'Madrid',       'Avda. Pablo Iglesias s/n, 28922',                                'Manuel Jiménez',                              '656 630 820', 'manolosensey@hotmail.es',           'aikidumaru.com'),
      ('Aikido Nakama',                 'Colmenar Viejo',        'Madrid',       'C/ Isaac Albéniz, 20, 28770',                                    'Alejandro Gómez',                             '687 294 817', 'alejandro.antropo@gmail.com',        NULL),
      ('A.C. Tada Ima Dojo',            'Sabadell',              'Barcelona',    'Esteve Paluzie 16 (Local), 08204',                               'Rubén Varona',                                '937 120 788', 'info@tadaimadojo.com',              'tadaimadojo.com'),
      ('Pa-Ki-Jo (Gimn. España)',       'Madrid',                'Madrid',       'C/ Juan de Peñalver 56, 28021',                                  'Francisco Castillo',                          '917 968 840', 'sanfermin@archimadrid.es',           NULL),
      ('Pa-Ki-Jo (Team Equilibra-T)',   'Madrid',                'Madrid',       'Av. Verbena de la Paloma, 12, 28021',                            'Francisco Castillo',                          '910 118 381', 'pacoaikido@yahoo.es',                NULL),
      ('Body Gym Avalon',               'Albacete',              'Albacete',     'Carretera Córdoba–Valencia, 97, 02200',                          'Manuel Calomarde',                            '679 623 853',  NULL,                                NULL),
      ('A.C.W. Aikido Bonastre',        'Bonastre',              'Tarragona',    'Plaza La Vinya 96, 43884',                                       'Nicolás González',                            '689 825 742', 'nicolasdojobonastre@gmail.com',      NULL),
      ('Club Casa Zen',                 'Las Torres de Cotillas','Murcia',       '30565',                                                          'Francisco Antonio Espinosa',                  '600 819 065',  NULL,                                NULL),
      ('Escuela Asturiana de Musculación','Gijón',               'Asturias',     'C/ Manuel Rodríguez Álvarez 34, 33213',                          'Adrián Vegas · Francisco Serrano',            '659 864 118', 'aikidonorte.es@gmail.com',          'aikidonorte.es'),
      ('Polideportivo de Carbayin Bajo','Siero',                 'Asturias',     'El Cotayu s/n, 33936',                                           'Abel Rubio González · Francisco Serrano',     '670 578 736', 'aikidonorte.es@gmail.com',          'aikidonorte.es'),
      ('International Shotokan Karate Academy','Gijón',          'Asturias',     'C/ Horacio Fernández Inguanzo, 5, 33210',                        'Enrique Aguera · Francisco Serrano',          '684 614 277', 'aikidonorte.es@gmail.com',          'aikidonorte.es'),
      ('Gimnasio Prieto',               'Oviedo',                'Asturias',     'C/ Argañosa 55, 33012',                                          'Patricia Carrera · Francisco Serrano',        '985 273 834', 'aikidonorte.es@gmail.com',          'aikidonorte.es'),
      ('Dojo Takeshi',                  'Madrid',                'Madrid',       'C/ Antonio López, 138, 28026',                                   'Rubén López',                                 '648 273 129', 'aikidomejorada@outlook.com',         NULL),
      ('Nuevo Polideportivo Pola de Siero','Siero',              'Asturias',     'AS-331, 15, 33519',                                              'Sergio Manuel Manzano · Francisco Serrano',   '625 173 926', 'aikidonorte.es@gmail.com',          'aikidonorte.es'),
      ('Ayumu Aikido',                  'Santoña',               'Cantabria',    'C/ Sor María del Carmen 7, 39740',                               NULL,                                          '680 605 617', 'info@ayumu.es',                     'ayumu.es')
    ) AS t(name, city, province, address, sensei, phone, email, web)
  LOOP
    -- Solo insertamos si no existe ya un dojo con el mismo nombre+ciudad.
    IF NOT EXISTS (
      SELECT 1 FROM app_aikikan.dojos
      WHERE app_id = v_app_id AND tenant_id = v_tenant_id
        AND name = rec.name AND city = rec.city
    ) THEN
      v_pos := v_pos + 1;
      INSERT INTO app_aikikan.dojos
        (app_id, tenant_id, name, city, province, address, sensei, phone, email, web, position)
      VALUES
        (v_app_id, v_tenant_id, rec.name, rec.city, rec.province, rec.address, rec.sensei, rec.phone, rec.email, rec.web, v_pos);
    END IF;
  END LOOP;
END
$$;
