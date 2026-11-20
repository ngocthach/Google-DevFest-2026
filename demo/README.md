# RoomLab: Google ADK + real WebMCP

## Cần gì?

- Python 3.10+ và Internet để cài thư viện và gọi Gemini.
- Gemini API key từ Google AI Studio (có thể phát sinh chi phí theo tài khoản). Không đưa key vào slide hoặc chat.
- Chrome phiên bản hỗ trợ **cả** `document.modelContext.registerTool`, `getTools` và `executeTool`. Kiểm tra hướng dẫn WebMCP của Chrome; nếu phiên bản yêu cầu, bật `chrome://flags/#enable-webmcp-testing` và khởi động lại Chrome. Flag có thể thay đổi theo phiên bản.

## Chạy cả hai demo trên macOS

Trong Terminal:

```bash
cd '/Users/ngocthach/Documents/ChatGPT/Google/devfest-webmcp-v2'
./Start-Demos.command
```

Chờ “Ready”, giữ Terminal mở, rồi vào http://127.0.0.1:8766/ cho RoomLab và http://127.0.0.1:3001/studio cho ArchMorph trong Chrome có WebMCP. Script đọc key từ `.env` hoặc hỏi nếu thiếu. Nhấn Ctrl+C để dừng các server do script tạo. Nếu cổng 8766, 8767 hoặc 3001 đang bận, dừng server cũ trước khi chạy lại. Không dùng `file:///.../index.html`.

Trong RoomLab, kiểm tra **Connection & WebMCP tools** và **ADK connected**, rồi thử inspect. Trong ArchMorph bấm **Load Studio demo**, **Use demo prompt** và **Send**. Xem [Presenter guide](../Presenter-Guide.html) để có toàn bộ kịch bản.

## Các thành phần

Chỉ cần một lệnh khởi động sau lần cài đầu, một trang web và API key. Tool `create_room` tạo phòng theo tọa độ (x, y) từ góc trên trái, tính bằng mét; app từ chối phòng trùng ID, chồng lấn hoặc nằm ngoài khu đất. Có thể undo thao tác tạo phòng. Chatbot có trong trang, không cần cài extension agent riêng. Google ADK chạy ở Python; Gemini quyết định gọi tool; Python gửi yêu cầu tới tab qua WebSocket; tab tìm và thực thi tool thật qua WebMCP; kết quả đi ngược lại cho ADK. Plan và log nằm trong tab và reset khi tải lại. Key chỉ nằm trong biến môi trường của tiến trình server. Không dùng server này trên mạng công cộng.

Tài liệu: https://developer.chrome.com/docs/ai/webmcp/imperative-api và https://google.github.io/adk-docs/ .

## Thêm nội thất bằng voice

Chọn **🎙 Voice**, cho phép microphone, đợi kết nối rồi nói, ví dụ: “Thêm một cái bàn làm việc vào phòng ngủ.” Giữ voice bật đến khi agent trả lời; nhấn **Stop voice** để tắt microphone. Bạn cũng có thể gõ yêu cầu trong chat. Tool `place_furniture` hỗ trợ sofa, chair, table, desk, bed, bookshelf, plant và lamp; `inspect_plan` hiển thị nội thất đã thêm, revision kiểm soát trạng thái cũ và undo hoàn tác lần chỉnh sửa gần nhất.

Nội thất dùng kích thước mẫu gần đúng theo mét và được vẽ cùng tỷ lệ với phòng. Ứng dụng từ chối vật thể chồng nhau hoặc nằm ngoài phòng; không thay thế thiết kế nội thất thực tế.

Để di chuyển nội thất, kéo biểu tượng trong phòng; hoặc chọn biểu tượng và dùng các phím mũi tên. Cũng có thể nói “chuyển bàn sang bên phải phòng ngủ”: agent đọc ID rồi gọi `move_furniture`. Vị trí tâm là tương đối trong phòng, có thể undo; vị trí chồng nhau hoặc ngoài phòng sẽ bị từ chối.

Kích thước mẫu (rộng × sâu, mét): sofa 2 × 0,9; giường 1,6 × 2; bàn/bàn làm việc 1,2 × 0,7/0,6; ghế 0,6 × 0,6; kệ 0,9 × 0,35; cây 0,5 × 0,5; đèn 0,3 × 0,3. Đây là kích thước mặc định gần đúng, chưa hỗ trợ xoay đồ hoặc lối đi tối thiểu.
