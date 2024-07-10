const { createBot, createProvider, createFlow, addKeyword, EVENTS, addAnswer } = require('@bot-whatsapp/bot');
require("dotenv").config();

const QRPortalWeb = require('@bot-whatsapp/portal');
const BaileysProvider = require('@bot-whatsapp/provider/baileys');
const MockAdapter = require('@bot-whatsapp/database/mock');
const path = require("path");
const fs = require("fs");

const { handlerAIImage } = require('./openai/imagen-text');
const { handlerAI } = require('./openai/whisper');
const { handleUserMessage } = require('./utils/memory');
const { appendToSheet } = require('./utils/google-sheets');

// Archivo donde se guardan los números bloqueados y contadores
const dataFile = path.join(__dirname, 'data.json');
const infoFile = path.join(__dirname, 'pdf', 'CloudChatAI.txt');
const infomation = fs.readFileSync(infoFile, "utf8");

// Cargar datos desde el archivo JSON
const loadData = () => {
    if (fs.existsSync(dataFile)) {
        const data = fs.readFileSync(dataFile, 'utf-8');
        return JSON.parse(data);
    }
    return { blockedNumbers: [], interactionCounts: {} };
};

// Guardar datos en el archivo JSON
const saveData = (data) => {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
};

// Cargar datos al iniciar
let { blockedNumbers, interactionCounts } = loadData();

// Lista de administradores
const adminNumbers = ["5493512413236"]; // Añade aquí los números de los administradores

// Límites de interacciones
const TEXT_AUDIO_LIMIT = 20;
const IMAGE_LIMIT = 3;

// Función para verificar si un número está bloqueado
const isBlocked = (number) => {
    return blockedNumbers.includes(number);
};

// Función para bloquear un número
const blockNumber = (number) => {
    if (!blockedNumbers.includes(number)) {
        blockedNumbers.push(number);
        saveData({ blockedNumbers, interactionCounts });
    }
};

// Función para desbloquear un número
const unblockNumber = (number) => {
    blockedNumbers = blockedNumbers.filter(num => num !== number);
    saveData({ blockedNumbers, interactionCounts });
};

// Función para verificar si un número es administrador
const isAdmin = (number) => {
    return adminNumbers.includes(number);
};

// Función para verificar y actualizar contadores de interacciones
const checkAndUpdateCounts = (number, type) => {
    if (!interactionCounts[number]) {
        interactionCounts[number] = { textAudio: 0, images: 0 };
    }

    if (type === 'textAudio') {
        if (interactionCounts[number].textAudio >= TEXT_AUDIO_LIMIT) {
            return false;
        }
        interactionCounts[number].textAudio += 1;
    } else if (type === 'images') {
        if (interactionCounts[number].images >= IMAGE_LIMIT) {
            return false;
        }
        interactionCounts[number].images += 1;
    }

    saveData({ blockedNumbers, interactionCounts });
    return true;
};

// Función para mostrar la lista de comandos
const showHelp = async (ctxFn) => {
    const helpMessage = `Lista de comandos disponibles:
!block <número> - Bloquear un número
!unblock <número> - Desbloquear un número
!listblocked - Listar números bloqueados
`;
    await ctxFn.flowDynamic(helpMessage);
};

const flowinfo = addKeyword("info")
    .addAnswer(infomation);

const flowcontact = addKeyword(["contact"])
    .addAnswer('Bienvenido al formulario de contacto, te haré un par de preguntas')
    .addAnswer('Nombre completo?', { capture: true },
        async (ctx, ctxFn) => {
            await ctxFn.state.update({ name: ctx.body })
        }
    )
    .addAnswer('Email personal?', { capture: true },
        async (ctx, ctxFn) => {
            await ctxFn.state.update({ email: ctx.body })
        }
    )
    .addAnswer('Motivo de consulta?', { capture: true },
        async (ctx, ctxFn) => {
            await ctxFn.state.update({ motive: ctx.body })
        }
    )
    .addAnswer('Gracias. Tus datos fueron registrados', null,
        async (ctx, ctxFn) => {
            const name = ctxFn.state.get("name")
            const email = ctxFn.state.get("email")
            const motive = ctxFn.state.get("motive")
            await appendToSheet([[name, email, motive]])
        }
    )


// Administrador agrega y elimina números de la lista de bloqueo, y lista los números bloqueados
const flowAdmin = addKeyword(['!block', '!unblock', '!listblocked', '!help'])
    .addAction(async (ctx, ctxFn) => {
        if (!isAdmin(ctx.from)) {
            await ctxFn.flowDynamic("No tienes permisos para usar este comando.");
            return;
        }

        const [command, number] = ctx.body.split(' ');

        if (command === '!block' && number) {
            blockNumber(number);
            await ctxFn.flowDynamic(`El número ${number} ha sido bloqueado.`);
        } else if (command === '!unblock' && number) {
            unblockNumber(number);
            await ctxFn.flowDynamic(`El número ${number} ha sido desbloqueado.`);
        } else if (command === '!listblocked') {
            const blockedList = blockedNumbers.length ? blockedNumbers.join('\n') : "No hay números bloqueados.";
            await ctxFn.flowDynamic(`Lista de números bloqueados:\n${blockedList}`);
        } else if (command === '!help') {
            await showHelp(ctxFn);
        } else {
            await ctxFn.flowDynamic(`Comando no reconocido. Use !block <número>, !unblock <número>, !listblocked o !help.`);
        }
    });

// Patrón genérico para capturar cualquier mensaje de texto
const flowMessage = addKeyword(EVENTS.WELCOME)
    .addAction(async (ctx, ctxFn) => {
        if (isBlocked(ctx.from)) {
            await ctxFn.flowDynamic("Lo siento, estás bloqueado.");
            return;
        }
        if (!checkAndUpdateCounts(ctx.from, 'textAudio')) {
            await ctxFn.flowDynamic("Has alcanzado el límite de interacciones de texto/audio.");
            return;
        }
        await handleUserMessage(ctx, ctxFn, ctx.body);
    });

const flowImage = addKeyword(EVENTS.MEDIA)
    .addAction(async (ctx, ctxFn) => {
        if (isBlocked(ctx.from)) {
            await ctxFn.flowDynamic("Lo siento, estás bloqueado.");
            return;
        }
        if (!checkAndUpdateCounts(ctx.from, 'images')) {
            await ctxFn.flowDynamic("Has alcanzado el límite de interacciones de imagen.");
            return;
        }
        await ctxFn.flowDynamic("🖼️ Procesando imagen... 📷🔄");
        const userId = ctx.from;
        const imagen = await handlerAIImage(ctx, ctx.from);
        if (ctx.caption) {
            if (!checkAndUpdateCounts(ctx.from, 'textAudio')) {
                await ctxFn.flowDynamic("Has alcanzado el límite de interacciones de texto/audio.");
                return;
            }
            await handleUserMessage(ctx, ctxFn, ctx.caption);
        }
        await handleUserMessage(ctx, ctxFn, imagen);
    });

const flowVoice = addKeyword(EVENTS.VOICE_NOTE)
    .addAction(async (ctx, ctxFn) => {
        if (isBlocked(ctx.from)) {
            await ctxFn.flowDynamic("Lo siento, estás bloqueado.");
            return;
        }
        if (!checkAndUpdateCounts(ctx.from, 'textAudio')) {
            await ctxFn.flowDynamic("Has alcanzado el límite de interacciones de texto/audio.");
            return;
        }
        const voz = await handlerAI(ctx);
        await handleUserMessage(ctx, ctxFn, voz);
    });

const main = async () => {
    const adapterDB = new MockAdapter();
    const adapterFlow = createFlow([flowMessage, flowinfo, flowVoice, flowImage, flowAdmin, flowcontact]);
    const adapterProvider = createProvider(BaileysProvider);

    createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    QRPortalWeb();
};

main();



















