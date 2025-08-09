

export function generateInvoiceId () {
    const now = new Date();
    const pad = (num) => num.toString().padStart(2, "0");
    const ms = now.getMilliseconds().toString().padStart(3, "0");
    const formattedDate = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${ms}`;
    return `INV-${formattedDate}`;
  }