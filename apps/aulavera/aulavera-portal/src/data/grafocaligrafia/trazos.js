// Los Doce Trazos de la Grafología Racional® — contenido del método de
// Juanjo Vara (discípulo de D. Vicente Lledó Parrés), reproducido con
// permiso desde grafocaligrafiaracional.com. Cada trazo es una unidad de
// observación con su "temperatura" (-n/M exceso, -n/P insuficiencia) y sus
// esencias principales bien (+) y mal (-) hechas.
//
// Agrupación del Gran Test (ver granTest.js):
//   Inteligencia → trazos 1, 4, 7, 10 · Sentimiento → 2, 5, 8, 11 · Voluntad → 3, 6, 9, 12

export const trazos = [
  {
    id: 'observacion',
    n: 1,
    nombre: 'La Observación',
    trazo: 'Sube regresando',
    grupo: 'inteligencia',
    img: '/grafocaligrafia/img/trazo-observacion.jpg',
    intro:
      'En el mundo exterior está expuesto todo aquello que forma la «materia prima» de lo que estamos hechos, y también todo aquello que necesitamos para vivir. Pero también está allí todo aquello que nos puede perjudicar, en el caso de que lo tomáramos o lo tocáramos, porque «no es oro todo lo que reluce»; a veces las cosas no son lo que aparentan o lo que nosotros creemos. Las funciones de la observación son las encargadas de «vigilar» que aquello que adquiramos o interioricemos esté de acuerdo con nuestro propio sentido de lo verdadero, beneficioso, positivo, etc.',
    pregunta: '¿Qué tal observador es usted?',
    temperatura: {
      M: 'Demasiada observación. Cualquier cosa (una persona, una prenda de vestir, un alimento, etc.) es observada por usted hasta tal punto que acaban apareciendo, lógicamente, pequeñas faltas o defectos, que usted se encarga de exagerar, convirtiéndolos en impedimentos para que sean identificados.',
      P: 'Adolece de ser poco observador; se despreocupa bastante en este sentido. En muchas ocasiones acomete un asunto, compra algo, realiza un trabajo, etc. sin la previa observación. Tampoco se previene a tiempo. Es confiado.',
    },
    esenciasBien: [
      { clave: '+1/A', texto: 'Tiene la cualidad de ver con claridad cuanto observa. Es objetivo al examinar a los demás. Ve tanto sus virtudes como sus defectos.' },
      { clave: '+1/E', texto: 'Ve más la sustancia de la cosa observada; el posible beneficio o perjuicio que ello le pueda acarrear.' },
      { clave: '+1/I', texto: 'Tiene la capacidad de la constancia y la paciencia en la observación. El objetivo a observar no le turba ni le conmueve. Observa tranquilo.' },
    ],
    esenciasMal: [
      { clave: '-1/B', texto: 'Es subjetivo. Ve las cosas, no como son realmente, sino como usted piensa que son, según su criterio. Ve las cosas de diferente manera que la mayoría de las personas.' },
      { clave: '-1/F', texto: 'No alcanza a ver la sustancia de las cosas observadas. Se deja engañar por lo aparente o por lo que no es real.' },
      { clave: '-1/J', texto: 'Sus observaciones son inquietas, intranquilas, sin sosiego, lo que le incapacita para la atención y la concentración.' },
    ],
  },
  {
    id: 'adquisicion',
    n: 2,
    nombre: 'La Adquisición',
    trazo: 'Sube centrado',
    grupo: 'sentimiento',
    img: '/grafocaligrafia/img/trazo-adquisicion.jpg',
    intro:
      'Como seres vivos que somos, estamos condicionados a tener que nutrirnos para poder sobrevivir, y como seres sociales tenemos que procurarnos unos bienes económicos y unos conocimientos prácticos para sostener esa convivencia social. Es ésta y no otra la manera de procurarnos una energía que nos mantenga vivos; una energía que, por supuesto, se encuentra siempre fuera de nosotros, y de alguna manera hemos de interiorizarla.',
    pregunta: '¿Qué tal carácter adquisitivo tiene usted?',
    temperatura: {
      M: 'Abusa usted bastante de todas aquellas acciones que representan llevar hacia su interior las cosas: introyectar, adquirir, tomar, comprar, coger, etc. Le gusta pedir, que le regalen cosas, ir de compras, etc.',
      P: 'Tiene usted una insuficiencia generalizada del sentido de la adquisición, es decir, una considerable pérdida de interés por aquellas cosas que necesita. Casi nunca pide nada, aunque lo necesite mucho.',
    },
    esenciasBien: [
      { clave: '+2/A', texto: 'Se da cuenta, con buen sentido, de qué cosas de las que adquiere o toma le pueden llegar a perjudicar o a beneficiar.' },
      { clave: '+2/E', texto: 'Cuando adquiere o toma algo, le interesa más la sustancia o la consecuencia de la cosa que su aspecto externo o su significado social.' },
      { clave: '+2/I', texto: 'Cuando adquiere o toma cualquier cosa, lo suele hacer tranquilo y sin ansia. Se suele satisfacer con normalidad.' },
    ],
    esenciasMal: [
      { clave: '-2/B', texto: 'No suele fijarse mucho si las cosas que adquiere o toma le pueden llegar a beneficiar o a perjudicar. Puede adquirir algo que le pueda perjudicar.' },
      { clave: '-2/F', texto: 'Cuando adquiere o toma algo, le interesa más el aspecto externo de la cosa que su propia sustancia o su consecuencia.' },
      { clave: '-2/J', texto: 'Al adquirir o tomar algo, suele reaccionar con ansia. Cada vez necesita más. No se satisface.' },
    ],
  },
  {
    id: 'superacion',
    n: 3,
    nombre: 'La Superación',
    trazo: 'Sube avanzando',
    grupo: 'voluntad',
    img: '/grafocaligrafia/img/trazo-superacion.jpg',
    intro:
      'Dice el refrán que «el que algo quiere, algo le cuesta». Efectivamente, si queremos ser algo en la vida, tener unos bienes o conseguir algún tipo de mejora, debemos usar toda nuestra fuerza de voluntad y todo nuestro esfuerzo personal para conseguirlo. Estas son esas funciones que, a base de paciencia y constancia, nos permiten conseguir nuestras aspiraciones.',
    pregunta: '¿Qué tal se autosupera usted? ¿Y la paciencia?',
    temperatura: {
      M: 'Generalmente hace usted más cosas de las que son necesarias. Trabaja para nada, lo cual no le importa mucho. Da muchas vueltas hasta que llega al punto deseado.',
      P: 'Pocas veces se mete usted a emprender trabajos o asuntos que impliquen grandes esfuerzos; los evita en todo lo posible. También puede llegar a abandonar las obligaciones.',
    },
    esenciasBien: [
      { clave: '+3/A', texto: 'Tiene una idea clara y concreta de aquello que pretende realizar. Cualquier esfuerzo, gestión, trabajo, etc., tiene una meta y un objetivo concreto.' },
      { clave: '+3/E', texto: 'Sus esfuerzos y sus empeños van siempre dirigidos a conseguir cosas sustanciosas y prácticas que le lleguen a beneficiar.' },
      { clave: '+3/I', texto: 'Sabe dar una estabilidad al trabajo que realiza. Es constante en aquellos trabajos o asuntos que requieren un tratamiento largo y costoso. Sabe repartir el esfuerzo a lo largo del tiempo que debe emplear.' },
    ],
    esenciasMal: [
      { clave: '-3/B', texto: 'No tiene una idea concreta de lo que quiere conseguir con su trabajo y su esfuerzo. Falta de planificación.' },
      { clave: '-3/F', texto: 'Valora más el esfuerzo que realiza para conseguir algo que ese algo. Para usted es más importante cómo se hace que aquello que se hace.' },
      { clave: '-3/J', texto: 'No es usted una persona tranquila y sosegada. Hace todo como si alguien le estuviera metiendo prisa. Inconstante e impaciente. No sabe repartir el esfuerzo a lo largo del trabajo.' },
    ],
  },
  {
    id: 'deliberacion',
    n: 4,
    nombre: 'La Deliberación',
    trazo: 'Regresa bajando',
    grupo: 'inteligencia',
    img: '/grafocaligrafia/img/trazo-deliberacion.jpg',
    intro:
      'No solo nos alimentamos de materia; «no solo de pan vive el hombre»; no solo somos cuerpo sino también mente. Nuestro organismo necesita también alimentarse de ideas para sobrevivir. Pues bien, estas ideas deben «unirse» a nuestros arquetipos (ideas con las que ya nacemos) para obtener nuevas formas del pensamiento, o sea, lo que entendemos como creatividad.',
    pregunta: '¿Qué tal está usted de creatividad?',
    temperatura: {
      M: 'Exceso de deliberación. Un simple inconveniente puede llegar a ser un grave problema conforme va aumentando el proceso deliberativo sobre el mismo.',
      P: 'No le gusta pensar mucho; prefiere encontrar la solución a los problemas de otra manera que no sea pensando; prefiere soluciones «prefabricadas». Piensa, erróneamente, que los problemas no se solucionan con la cabeza.',
    },
    esenciasBien: [
      { clave: '+4/B', texto: 'Tiene capacidad para concebir nuevas ideas, diferentes de las que ya aprendió en los modelos, es decir, que tiene creatividad. Facilidad para la innovación de las imágenes.' },
      { clave: '+4/F', texto: 'Es capaz de llegar con el pensamiento a lugares que aún no habían sido explorados. Amplitud de miras.' },
      { clave: '+4/J', texto: 'Tiene la suficiente energía mental para deliberar y deliberar hasta hallar la solución al problema planteado.' },
    ],
    esenciasMal: [
      { clave: '-4/A', texto: 'Tiene poca capacidad para concebir ideas nuevas. Sólo usa los modelos aprendidos con anterioridad o los que otros le enseñan, sin añadir ni quitar nada.' },
      { clave: '-4/E', texto: 'Poco interés por rebuscar datos en el «baúl» de sus contenidos mentales, por el simple hecho de ver un poco más allá de lo conocido.' },
      { clave: '-4/I', texto: 'No revitaliza o regenera la energía gastada durante el esfuerzo de pensar; se cansa pronto.' },
    ],
  },
  {
    id: 'seleccion',
    n: 5,
    nombre: 'La Selección',
    trazo: 'Regresa centrado',
    grupo: 'sentimiento',
    img: '/grafocaligrafia/img/trazo-seleccion.jpg',
    intro:
      'Cada uno de nosotros somos un «ejemplar único». Somos diferentes a cualquiera de los humanos. Por eso las cosas del mundo exterior causan en nosotros un impacto emotivo diferente, según seamos. Esto sucede en virtud de nuestras funciones de la selección; ellas son las que hacen que amemos u odiemos unas cosas más que otras sin que sepamos el porqué.',
    pregunta: '¿Cuáles son sus preferencias? ¿Y sus gustos?',
    temperatura: {
      M: 'Excesiva selección, es decir, que todo tiene que ser juzgado o catalogado por usted, aunque poco tenga que ver con ello. Decide el bien y el mal de las cosas a la ligera. Es partidario de los favoritismos.',
      P: 'Le cuesta decidirse por una u otra cosa. Le es difícil llegar a amar a alguien, pero tampoco es de los que odian. No tiene aficiones muy definidas.',
    },
    esenciasBien: [
      { clave: '+5/B', texto: 'Sabe detectar, tanto en usted mismo como en los demás, aquellas cosas que precisamente por ser diferentes lo distinguen de los demás. Entiende lo agradable o desagradable que puede llegar a ser lo exótico o misterioso.' },
      { clave: '+5/F', texto: 'Al seleccionar las cosas o las personas, lo hace tal cual lo siente; ama u odia porque así lo siente su corazón. Expulsa de su ser aquello que no le gusta o se identifica profundamente con aquello que le gusta.' },
      { clave: '+5/J', texto: 'Hay emoción y calor en las cosas que ama u odia. Su organismo toma parte en aquello que siente su corazón ante el objeto amado u odiado.' },
    ],
    esenciasMal: [
      { clave: '-5/A', texto: 'Se inclina más por aquellas cosas que son comunes y corrientes, que no encierren grandes misterios. Es usted de gustos vulgares.' },
      { clave: '-5/E', texto: 'No siente ni odio ni amor; no se apasiona por nada. Ni sabe expulsar de su ser aquello que odia, ni sabe unirse a aquello que ama.' },
      { clave: '-5/I', texto: 'Hay cierta frialdad visceral ante la persona, idea o cosa elegida por usted. Su organismo no participa de lo que siente su corazón.' },
    ],
  },
  {
    id: 'variacion',
    n: 6,
    nombre: 'La Variación',
    trazo: 'Regresa subiendo',
    grupo: 'voluntad',
    img: '/grafocaligrafia/img/trazo-variacion.jpg',
    intro:
      'En nuestro organismo se producen constantemente cambios bioquímicos que estimulan nuestra actividad física, y por lo tanto volitiva. Cualquier cosa que se produce en nuestro entorno nos causa una reacción que es a su vez la que va a estimular nuestra voluntad. Todo ello hará que cambiemos de actitud, según convenga. Lo que comúnmente se conoce por reflejos.',
    pregunta: '¿Qué tal los suyos? ¿Cómo reacciona?',
    temperatura: {
      M: 'Le es imposible evitar la variación o cambios de actitudes innecesarios al conversar, andar, gesticular, etc. Cambia de parecer muy a menudo.',
      P: 'Insuficiencia de reacciones. Invariabilidad. No tiene cambios lógicos de actitud. Gesticula poco y se mueve lo imprescindible.',
    },
    esenciasBien: [
      { clave: '+6/B', texto: 'Sus reacciones van acompañadas también de una nueva forma de pensar. Su mente va creando conforme va cambiando la situación.' },
      { clave: '+6/F', texto: 'Sus cambios y reacciones van acompasados de deseos más o menos sentidos en su corazón, o sea, que no suele manifestar en sus reacciones otra cosa que lo que siente realmente.' },
      { clave: '+6/J', texto: 'Aumento natural de la energía interna ante cualquier tipo de cambio: está preparado para acusar lo que inesperadamente se produzca y variar de actitud, según convenga. Recupera con normalidad la energía gastada.' },
    ],
    esenciasMal: [
      { clave: '-6/A', texto: 'No entiende bien que todo cambio debe ser acompañado de una idea diferente y usted las encuadra todas en un mismo patrón. Monotonía.' },
      { clave: '-6/E', texto: 'Sus reacciones o cambios de actitud son fríos y calculados. Nada cambiaría en usted por puro placer o tristeza, sino por interés o necesidad.' },
      { clave: '-6/I', texto: 'No hay una buena estimulación energética biológica en sus reacciones. «No recarga usted las pilas», como se dice. No se prepara lo suficiente para afrontar las posibles eventualidades.' },
    ],
  },
  {
    id: 'defensa',
    n: 7,
    nombre: 'La Defensa',
    trazo: 'Baja regresando',
    grupo: 'inteligencia',
    img: '/grafocaligrafia/img/trazo-defensa.jpg',
    intro:
      'A veces (desgraciadamente son muchas veces) el mundo se vuelve contra nosotros; sentimos que nos ataca, que nos quiere perjudicar, pretende quitarnos lo que es nuestro, etc. Es entonces cuando nuestros mecanismos de defensa y nuestra voluntad actúan con fuerza. Si no fuera así, el ambiente antagónico acabaría con nosotros.',
    pregunta: '¿Cómo anda usted de mecanismos de defensa? ¿Se pasa o no llega?',
    temperatura: {
      M: 'Considera todo cuanto le rodea con un cierto grado de antagonismo hacia usted. Todo lo ve con una vestidura de engaño, maldad, segundas intenciones, etc., y por ello siempre está a la defensiva.',
      P: 'Falta de defensa. Odia las riñas, y ante tales situaciones opta por abandonar el campo, lo cual puede ser positivo sólo en determinadas ocasiones, ya que en otras es necesario defenderse, por ejemplo cuando pretenden avasallarnos.',
    },
    esenciasBien: [
      { clave: '+7/D', texto: 'Sus mecanismos de defensa actúan de forma pausada; sabe detenerse a estudiar el terreno contrario antes de actuar. No se precipita.' },
      { clave: '+7/G', texto: 'Sus luchas llevan el sello del orden y del equilibrio. Donde pone el ojo pone la flecha; castiga sólo aquello que debe ser castigado. Es justo en el combate.' },
      { clave: '+7/K', texto: 'Tiene usted un buen potencial energético para la defensa. Sus luchas frente a los antagonismos se ven respaldadas por la fuerza. Su voluntad responde, naturalmente, ante quienes pretenden perjudicarle.' },
    ],
    esenciasMal: [
      { clave: '-7/C', texto: 'Se precipita en la defensa, no sabe estudiar el terreno enemigo. Se defiende sin pensarlo mucho, pero sin seguridad.' },
      { clave: '-7/H', texto: 'No puede controlar sus emociones ante las injusticias. No sabe dirigir bien los golpes. No sabe hacer daño.' },
      { clave: '-7/L', texto: 'No dispone de un buen potencial energético frente al enemigo. Su voluntad y su fuerza no responden ante quienes pretenden perjudicarle.' },
    ],
  },
  {
    id: 'autocontrol',
    n: 8,
    nombre: 'El Autocontrol',
    trazo: 'Baja centrado',
    grupo: 'sentimiento',
    img: '/grafocaligrafia/img/trazo-autocontrol.jpg',
    intro:
      'De todas las leyes naturales que rigen nuestras vidas, tal vez sea el orden la más importante de todas. Sin orden nada puede salir bien; acercarse al orden es acercarse a la perfección. Dependemos de un orden, de un equilibrio, de un «algo» desconocido que nos muestra unas pautas a seguir en el camino de la vida, que nos enseña a guiar nuestros caballos, que nos da un dominio sobre nosotros mismos.',
    pregunta: '¿Qué tal está su autocontrol?',
    temperatura: {
      M: 'Excesivo autocontrol. Le gusta a usted mandar sobre todo el mundo. Todo tiene que estar bajo su tutela. Le molesta que otros piensen cosas que no cuadran en sus propios patrones.',
      P: 'Falta de autocontrol. Le da igual el orden y la compostura social. No sabe mandar a sus inferiores ni sabe obedecer a sus superiores. No se da cuenta si molesta o hace el ridículo.',
    },
    esenciasBien: [
      { clave: '+8/D', texto: 'No suele precipitarse cuando desea controlar una situación, dirigir un asunto o trabajo, sino que le dedica el tiempo suficiente.' },
      { clave: '+8/G', texto: 'Para dominar las situaciones usa usted, con buen criterio, el orden. Pone cada cosa donde debe estar. Hace primero lo que es primero, y segundo lo segundo. Procura que todo esté más o menos localizado.' },
      { clave: '+8/K', texto: 'Tiene potencia para enfrentarse a cualquier rebeldía. Dispone de energía suficiente para afrontar cualquier eventualidad que atente contra su plan trazado.' },
    ],
    esenciasMal: [
      { clave: '-8/C', texto: 'Muchas veces las cosas se le escapan de las manos porque se precipita. Pretende acabar cuanto antes.' },
      { clave: '-8/H', texto: 'No tiene un buen control de las situaciones, pues los datos, las cosas, los momentos, etc. no tienen un determinado lugar ni un tiempo preciso para suceder. Se sitúan a capricho.' },
      { clave: '-8/L', texto: 'Poca energía para enfrentarse a eventualidades que puedan surgir en los que dirige. Es usted demasiado blando.' },
    ],
  },
  {
    id: 'predisposicion',
    n: 9,
    nombre: 'La Predisposición',
    trazo: 'Baja avanzando',
    grupo: 'voluntad',
    img: '/grafocaligrafia/img/trazo-predisposicion.jpg',
    intro:
      'Antes de hacer algo, antes de actuar, de hablar, dirigir, etc., se ha tenido que formular un juicio adecuado. Nada hacemos que no esté previsto por la mente. Siempre hay toda una gama de razonamientos previos a la acción definitiva. Ello implica la seguridad de lo que se hace.',
    pregunta: '¿Con qué argumentos cuenta para razonar?',
    temperatura: {
      M: 'Le resulta difícil llegar a decidirse porque le da demasiado tiempo a la elaboración de sus juicios. Falta de criterio. Cualquiera puede rebatir una decisión suya.',
      P: 'No suele pensar mucho las cosas antes de ponerlas en práctica. Actúa por puro impulso o cegado por su atrevimiento. No sabe retenerse ni frenar a tiempo.',
    },
    esenciasBien: [
      { clave: '+9/D', texto: 'Es usted pausado en la elaboración de sus juicios. Va despacio antes de la acción definitiva. Sus sentencias, juicios, decisiones, etc., han sido bien pensadas con anterioridad. Despacio y seguro.' },
      { clave: '+9/G', texto: 'En sus decisiones está presente siempre el orden y la lógica, lo que hace que sus juicios estén adecuados al ambiente social. Son sensatos, comprensibles a los demás.' },
      { clave: '+9/K', texto: 'Sus argumentos mentales tienen fuerza, convencen y se imponen a los demás por pura razón. Sus razonamientos desplazan a los demás criterios.' },
    ],
    esenciasMal: [
      { clave: '-9/C', texto: 'Es usted precipitado en la elaboración de sus juicios y decisiones. No les da el tiempo necesario para su madurez. Decide demasiado a la ligera. Esto le puede crear inseguridad.' },
      { clave: '-9/H', texto: 'Sus decisiones y sus juicios carecen de un orden y una lógica. Son decisiones tomadas con el corazón, no con el cerebro.' },
      { clave: '-9/L', texto: 'Sus argumentos y razones no tienen fuerza, no convencen a nadie, y por lo tanto pueden ser rebatidos con facilidad por cualquiera.' },
    ],
  },
  {
    id: 'comunicacion',
    n: 10,
    nombre: 'La Comunicación',
    trazo: 'Avanza bajando',
    grupo: 'inteligencia',
    img: '/grafocaligrafia/img/trazo-comunicacion.jpg',
    intro:
      'El hombre, por ser un ser inteligente, basa su comunicación también en la inteligencia, es decir, a base de signos e imágenes que representan ideas, como palabras, gestos, etc. Las funciones comunicativas están implicadas en la agilidad mental para poder encontrar rápidamente y de manera inconsciente los signos que han de representar nuestras ideas.',
    pregunta: '¿Sabe usted expresarse bien?',
    temperatura: {
      M: 'Le gusta mucho hablar, pero se pasa, ya que suele decir tanto lo que debe como lo que no debe. Tampoco hay una sustancialidad. Habla para nada.',
      P: 'A usted hay que sacarle las palabras con sacacorchos, como se dice. No es muy hablador, pero se pasa porque pierde poder de expresión.',
    },
    esenciasBien: [
      { clave: '+10/C', texto: 'Hay rapidez y fluidez en sus comunicados. Tiene facilidad para encontrar las palabras adecuadas a sus ideas. Comunica con sentido. Habla lo que realmente desea decir.' },
      { clave: '+10/H', texto: 'Expresa las cosas tal y como las siente. No es de los que dicen lo que no sienten. Sus palabras no ocultan nada, son sinceras.' },
      { clave: '+10/L', texto: 'Sus comunicados son agradables a quien los escucha, pues no hay agresividad en sus palabras. Habla teniendo en cuenta a su interlocutor.' },
    ],
    esenciasMal: [
      { clave: '-10/D', texto: 'No hay agilidad mental para encontrar las palabras que más le cuadran a lo que piensa. Comunicados poco fluidos, lentos, pesados, etc.' },
      { clave: '-10/G', texto: 'Sus palabras adolecen de falta de naturalidad. Cuando habla, lo hace para que le oigan, para que se fijen en usted, pero no para decir algo realmente.' },
      { clave: '-10/K', texto: 'Sus palabras son un tanto agresivas. No suele tener en cuenta para nada a su interlocutor.' },
    ],
  },
  {
    id: 'liberacion',
    n: 11,
    nombre: 'La Liberación',
    trazo: 'Avanza centrado',
    grupo: 'sentimiento',
    img: '/grafocaligrafia/img/trazo-liberacion.jpg',
    intro:
      'Pese a que el orden es tan importante, no todo debe ser orden, no todo debe ser centralización y autocontrol, sino que también debemos liberarnos de aquello que nos ata a nosotros mismos, de aquello que nos hace prisioneros de nuestros propios principios y deberes. Estas funciones de liberación también son nuestro propio albedrío, nuestra manifestación sincera de lo que sentimos; sin máscaras, sin prejuicios, etc.',
    pregunta: '¿Se considera espontáneo y natural?',
    temperatura: {
      M: 'Concibe usted la vida sin ningún tipo de norma que la controle. Va usted mucho más allá de lo que la gente entiende por naturalidad y espontaneidad. Se pasa. No tiene en cuenta el sentir de los demás, lo que le puede hacer parecer ineducado, sin que necesariamente tenga que serlo.',
      P: 'Ejerce la espontaneidad muy pocas veces. Casi nunca tiene usted manifestaciones de alegría ni de pena, aunque por dentro sí le sucedan. Puede desear expresar cosas pero no lo consigue; piensa que no es prudente o que no va a caer bien aquello que siente. No se excede usted jamás.',
    },
    esenciasBien: [
      { clave: '+11/C', texto: 'La expresión de sus sentimientos es fluida, espontánea, rápida y sin ninguna premeditación.' },
      { clave: '+11/H', texto: 'Manifiesta su manera de sentir y ser, sin prejuicios, con toda naturalidad. Es de los que no pueden evitar que se les note de inmediato el estado de ánimo. Le es imposible ocultar lo que siente.' },
      { clave: '+11/L', texto: 'Sus manifestaciones emotivas tienen el suficiente atractivo como para llegar agradablemente a los demás. Es usted agradable por su desenfado.' },
    ],
    esenciasMal: [
      { clave: '-11/D', texto: 'Es algo retardado a la hora de mostrar su alegría o su tristeza; estudia mucho sus expresiones.' },
      { clave: '-11/G', texto: 'Es usted una persona poco natural. No se manifiesta tal y como es realmente, ni como siente las cosas, sino como cree que deberían expresarse según las normas sociales. Tiene prejuicios.' },
      { clave: '-11/K', texto: 'Sus manifestaciones emotivas son duras; no reúnen el suficiente atractivo. Hay algo en usted que rechaza a los demás.' },
    ],
  },
  {
    id: 'adecuacion',
    n: 12,
    nombre: 'La Adecuación',
    trazo: 'Avanza subiendo',
    grupo: 'voluntad',
    img: '/grafocaligrafia/img/trazo-adecuacion.jpg',
    intro:
      'No todo en el ambiente es antagónico, no todo el mundo es malo, sino que a veces encontramos gente buena que nos quiere y nos ayuda. Es entonces cuando nuestras funciones de la adecuación se ponen a realizar su trabajo. La adecuación es esa amabilidad, ese compañerismo, esa entrega que a veces mostramos con los demás. Es a través de estas funciones como se cumple esa transferencia de poderes de nuestra voluntad; es aquí donde cedemos a la voluntad de los otros, porque ello nos complace.',
    pregunta: '¿Qué tal su entrega a los demás? ¿Es usted amable?',
    temperatura: {
      M: 'Para usted es normal desprenderse de lo suyo con tal de que el otro quede contento. Cuando esto llega a ser grave, le pasa hasta con el enemigo declarado. Se excede en complacer a los demás, incluso aunque no lo deseen. Se entrega demasiado.',
      P: 'Falta de entrega. No es de los que les gustan las pandillas y los grupos, sociedades, etc.; no es muy dado a fomentar las amistades.',
    },
    esenciasBien: [
      { clave: '+12/C', texto: 'Es diligente en servir al otro, no lo suele pensar mucho. Le resulta fácil la entrega y es el primero en iniciar la concordia y la reconciliación.' },
      { clave: '+12/H', texto: 'No hay una estudiada amabilidad, sino que es natural y espontánea. Tanto si se entrega como si no lo hace, es porque realmente lo siente así.' },
      { clave: '+12/L', texto: 'Ante la circunstancia de tener que unirse al otro por cualquier tipo de vínculo (matrimonio, amigo, compañero, etc.), es de los que facilitan al otro su estancia y su hacer para que no se encuentre molesto. Evita los inconvenientes entre ambos.' },
    ],
    esenciasMal: [
      { clave: '-12/D', texto: 'No es usted diligente en servir a su pareja, amigo, socio, etc. Es de los que esperan que sea el otro el que inicie la concordia. Se deja amar, pero no hace nada para que el otro se sienta amado.' },
      { clave: '-12/G', texto: 'Su entrega o amabilidad tan sólo es aparente pero no auténtica, o al menos la exagera más de lo que realmente es. Se considera más importante que su pareja.' },
      { clave: '-12/K', texto: 'Es demasiado duro con su pareja, amigo, socio, etc., pues todo lo quiere por la fuerza. No tiene tacto para la amistad y el trato.' },
    ],
  },
]
