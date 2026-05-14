
async function testChat(message: string) {
  console.log(`\nTesting message: "${message}"`);
  try {
    const response = await fetch("http://localhost:3000/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        conversationId: "debug-session-" + Date.now(),
      }),
    });

    const data: any = await response.json();
    console.log("Response:", JSON.stringify(data, null, 2));
  } catch (error: any) {
    console.error("Error:", error.message);
  }
}

async function runTests() {
  await testChat("สวัสดี");
  await testChat("Payso คืออะไร");
  await testChat("สมัคร Payso ยังไง");
  await testChat("มีค่าธรรมเนียมไหม");
  await testChat("จ่ายเงินไม่ได้ ต้องทำยังไง");
  await testChat("พรุ่งนี้ฝนตกไหม"); // Out of scope test
}

runTests();
