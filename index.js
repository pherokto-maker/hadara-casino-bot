// ====== Hadara Casino Bot – Plinko Pro ======

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  Partials,
  PermissionFlagsBits,
} = require('discord.js');

/* ضع بياناتك هنا */
const TOKEN              = 'const TOKEN = process.env.DISCORD_TOKEN;';
const GUILD_ID           = '1431949006321483899';
const OWNER_ID           = '740126120036270110';
const CASINO_CHANNEL_ID  = '1431971675452342353';

/* إعدادات البلينكو */
const MULTIS = [3.9, 2.4, 1.4, 0.7, 0.5, 0.3, 0.1]; // 7 أعمدة
const ROWS   = 10;                                   // ارتفاع اللوحة
const STEP_MS = 950;                                 // زمن التحديث (كل ~ثانية)

/* نظام رصيد بسيط (ذاكرة مؤقتة) */
const balances = new Map();
function getBalance(id)           { return balances.get(id) ?? 0; }
function setBalance(id, amount)   { balances.set(id, Math.max(0, amount)); }
function addBalance(id, delta)    { setBalance(id, getBalance(id) + delta); }

/* إنشاء العميل */
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

/* أوامر السلاش */
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('اختبار البوت'),

  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('عرض رصيدك'),

  new SlashCommandBuilder()
    .setName('addmoney')
    .setDescription('إضافة رصيد لعضو (مالك فقط)')
    .addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('المبلغ').setRequired(true)),

  new SlashCommandBuilder()
    .setName('plinko')
    .setDescription('لعبة Plinko')
    .addIntegerOption(o =>
      o.setName('bet')
       .setDescription('الرهان (HCC)')
       .setRequired(true)
       .setMinValue(1)
    ),
].map(c => c.toJSON());

/* تسجيل أوامر السلاش على السيرفر */
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  console.log('✅ Slash commands registered.');
}

/* رسم اللوحة + صف المضاعفات (يبرز العمود الحالي) */
function renderPlinkoBoard(rows, cols, ballRow, ballCol) {
  const empty = '▫️';
  const peg   = '▪️';
  const ball  = '🔘';

  const lines = [];

  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      if (r === ballRow && c === ballCol) line += ball + ' ';
      else line += (r % 2 === 0 ? empty : peg) + ' ';
    }
    lines.push(line.trim());
  }

  const multiLine = MULTIS
    .map((m, i) => (i === ballCol ? `**${m}x**` : `${m}x`))
    .join(' | ');

  lines.push('');
  lines.push(`📊 ${multiLine}`);

  return lines.join('\n');
}

/* تشغيل جولة البلينكو */
async function playPlinko(i, bet) {
  // لا يعمل إلا في روم الكازينو
  if (i.channelId !== CASINO_CHANNEL_ID) {
    return i.reply({ content: '❌ هذه اللعبة متاحة فقط في روم الكازينو المحدّد.', ephemeral: true });
  }

  // تحقق من الرصيد والرهان
  const bal = getBalance(i.user.id);
  if (bet <= 0) return i.reply({ content: '❌ الرهان يجب أن يكون رقمًا موجبًا.', ephemeral: true });
  if (bal < bet) return i.reply({ content: `❌ رصيدك غير كافٍ. رصيدك: **${bal} HCC**`, ephemeral: true });

  // خصم الرهان أولًا
  addBalance(i.user.id, -bet);

  const cols = MULTIS.length;
  let row = 0;
  let col = Math.floor(cols / 2); // البداية من الوسط

  let msg = await i.reply({
    content: `🎰 **Plinko**\n${renderPlinkoBoard(ROWS, cols, row, col)}\n\n💵 **الرهان:** ${bet} HCC`,
    fetchReply: true
  });

  // الأنيميشن
  while (row < ROWS - 1) {
    await new Promise(r => setTimeout(r, STEP_MS));
    col += Math.random() < 0.5 ? -1 : 1;
    col = Math.max(0, Math.min(cols - 1, col));
    row++;

    await msg.edit({
      content: `🎰 **Plinko**\n${renderPlinkoBoard(ROWS, cols, row, col)}\n\n💵 **الرهان:** ${bet} HCC`
    });
  }

  // حساب العائد وتحديث الرصيد
  const multi = MULTIS[col];
  const win   = Math.round(bet * multi);
  const net   = win; // لأننا خصمنا الرهان مسبقًا
  addBalance(i.user.id, net);

  await msg.edit({
    content:
`🎰 **Plinko**
${renderPlinkoBoard(ROWS, cols, row, col)}

🎯 **النتيجة:** ×${multi}
💵 **الرهان:** ${bet}
🏆 **العائد:** ${win}
💳 **رصيدك الآن:** ${getBalance(i.user.id)} HCC`
  });
}

/* التعامل مع الأوامر */
client.on('interactionCreate', async (i) => {
  try {
    if (!i.isChatInputCommand()) return;

    if (i.commandName === 'ping') {
      return i.reply('🏓 Pong!');
    }

    if (i.commandName === 'balance') {
      return i.reply(`💳 رصيدك: **${getBalance(i.user.id)} HCC**`);
    }

    if (i.commandName === 'addmoney') {
      if (i.user.id !== OWNER_ID)
        return i.reply({ content: '❌ الأمر للمالك فقط.', ephemeral: true });

      const user   = i.options.getUser('user', true);
      const amount = i.options.getInteger('amount', true);
      if (amount === 0) return i.reply({ content: 'المبلغ لا يمكن أن يكون صفر.', ephemeral: true });
      addBalance(user.id, amount);
      return i.reply(`✅ تمت إضافة **${amount} HCC** إلى <@${user.id}>.\n💳 رصيده الآن: **${getBalance(user.id)} HCC**`);
    }

    if (i.commandName === 'plinko') {
      const bet = i.options.getInteger('bet', true);
      return playPlinko(i, bet);
    }
  } catch (err) {
    console.error(err);
    if (i.deferred || i.replied) {
      i.followUp({ content: '⚠️ حدث خطأ غير متوقع.', ephemeral: true }).catch(()=>{});
    } else {
      i.reply({ content: '⚠️ حدث خطأ غير متوقع.', ephemeral: true }).catch(()=>{});
    }
  }
});

/* جاهزية وتشغيل */
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
  } catch (e) {
    console.error('Failed to register commands:', e);
  }
});

client.login(TOKEN);