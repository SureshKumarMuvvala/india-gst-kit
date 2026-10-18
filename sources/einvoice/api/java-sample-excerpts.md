# Java sample code excerpts (crypto and headers)

Short excerpts, for reference only, from the portals' "Sample Code in Java" pages. The code itself is **not** committed and must not be copied into packages. Captured 2026-10-18 through a browser in India.

Line numbers count lines in the page's code text after removing `\r` and replacing U+00A0 with a space: for the e-invoice page, the text of its 3 `pre`/`code` blocks joined with newlines (179 lines); for the e-way bill page, which has no `pre`/`code` blocks, the whole body text (257 lines). Lines are shown trimmed.

## e-invoice — https://einv-apisandbox.nic.in/sample-code-in-java.html

Raw page SHA-256 `63c5a355f95db9d2a0b23a6d8ff5478da7a420ecee5cf2e15fafa2e1dfcf4cd4`.

```
43: String appKey = Base64.getEncoder().encodeToString(createAESKey());
46: payload = Base64.getEncoder().encodeToString(payload.getBytes());
50: HttpPost postRequest = new HttpPost("<URL>/v1.04/auth");
51: postRequest.setHeader("client-id", "<Client Id>");
52: postRequest.setHeader("client-secret", "Client Secret");
53: postRequest.setHeader("gstin", "GSTIN");
91: FileInputStream in = new FileInputStream("<Path to File>/einv_sandbox.pem");
99: X509EncodedKeySpec spec = new X509EncodedKeySpec(keyBytes);
100: KeyFactory keyFactory = KeyFactory.getInstance("RSA");
106: KeyGenerator gen = KeyGenerator.getInstance("AES");
107: gen.init(128);
118: Cipher cipher = Cipher.getInstance("RSA/ECB/PKCS1PADDING");
119: cipher.init(Cipher.ENCRYPT_MODE, publicKeys);
120: byte[] encryptedText = cipher.doFinal(clearText.getBytes());
136: Key aesKey = new SecretKeySpec(appKey, "AES"); // converts bytes(32 byte random generated) to key
138: Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");  // encryption type = AES with padding PKCS5
139: cipher.init(Cipher.DECRYPT_MODE, aesKey); // initiate decryption type with the key
154: Key aesKey = new SecretKeySpec(sekByte, "AES");
156: Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");
157: cipher.init(Cipher.DECRYPT_MODE, aesKey);
```

## e-way bill — https://docs.ewaybillgst.gov.in/apidocs/sample-code-in-java.html

Raw page SHA-256 `2a3b99167c8ec05c98a268c47ed59112c8866af88dabb3c9eb3d9b84a359cd1b`.

```
62: String appKey = Base64.getEncoder().encodeToString(createAESKey());
65: payload = Base64.getEncoder().encodeToString(payload.getBytes());
69: HttpPost postRequest = new HttpPost("<URL>/v1.03/auth");
70: postRequest.setHeader("client-id", "<Client-id>");
71: postRequest.setHeader("client-secret", "Client-Secret");
72: postRequest.setHeader("gstin", "<gstin>");
118: FileInputStream in = new FileInputStream("<Path to file>/publickey.pem");
126: X509EncodedKeySpec spec = new X509EncodedKeySpec(keyBytes);
127: KeyFactory keyFactory = KeyFactory.getInstance("RSA");
135: KeyGenerator gen = KeyGenerator.getInstance("AES");
136: gen.init(128);
149: Cipher cipher = Cipher.getInstance("RSA/ECB/PKCS1PADDING");
150: cipher.init(Cipher.ENCRYPT_MODE, publicKeys);
151: byte[] encryptedText = cipher.doFinal(clearText.getBytes());
171: Key aesKey = new SecretKeySpec(appKey, "AES");
173: Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");
174: cipher.init(Cipher.DECRYPT_MODE, aesKey);
176: byte[] decryptedSekBytes = cipher.doFinal(encryptedSekBytes);
200: Key aesKey = new SecretKeySpec(sekByte, "AES");
203: Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");
204: cipher.init(Cipher.ENCRYPT_MODE, aesKey);
205: byte[] encryptedjsonbytes = cipher.doFinal(json.getBytes());
230: Key aesKey = new SecretKeySpec(sekByte, "AES");
232: Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");
233: cipher.init(Cipher.DECRYPT_MODE, aesKey);
235: byte[] decValue = cipher.doFinal(decordedValue);
```

## Notes

- **Both samples call `gen.init(128)`**, which makes a 16-byte AES AppKey, while the e-invoice comment (line 136) and the auth page say 32 bytes (44 Base64 characters). Settle on the first live call (spec D-G7).
- Both samples send hyphenated headers (`client-id`, `client-secret`, `gstin`), which supports the hyphen side of G4.
- Neither sample shows the e-way bill `rek` + HMAC response path.
- e-way bill line 205 encrypts `json.getBytes()`; from these lines alone it is not clear whether `json` is already the Base64 text. Live check.
