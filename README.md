# Unspoil

본 화수 뒤의 이야기만 가리는 스포일러 실드. 댓글은 그리기 전에 흐리고, 진행도를 올리면 그 자리의 네트워크 없이 다시 보인다.

## 실행

Node.js 22 이상이 필요하다.

```bash
npm install
npm run build
npm start
```

브라우저에서 [http://127.0.0.1:47821](http://127.0.0.1:47821) 을 연다. Groq 키는 설정 창에 붙여 넣는다. 키는 이 기기에만 남고, 확장 프로그램으로는 나가지 않는다.

Chrome에서 `chrome://extensions` → 개발자 모드 → `extension/dist` 를 압축해제 확장으로 불러온다. Hub 설정의 토큰을 팝업에 붙여 넣는다.

작품은 시리즈로 추가하고, 진행도는 마지막으로 본 화다. 데모는 [http://127.0.0.1:47821/demo/](http://127.0.0.1:47821/demo/) 의 팬 포럼이다. 제목에 Squid Game, 오징어 게임이 들어 있다. 댓글은 창작이다.

## 평가

기억이 준비된 작품이 있을 때 실행한다. 라벨은 시즌 1을 5화까지 본 상태, careful 기준이다. 30개 중 20개는 개발용, 10개는 held-out이다.

```bash
npm run eval
```

결과는 `eval/report.json` 에 저장되고, Hub의 Proof 화면에 표시된다. 키워드 기준선은 작품명과 인물명이 들어간 문장만 가린다. Unspoil은 그 문장이 몇 화까지 가는지를 본다.

## 한계

이미지와 영상 속 글자는 보지 않는다. 계정과 클라우드 동기화는 없다. YouTube, X, Reddit 선택자는 사이트 구조가 바뀌면 다시 맞춰야 한다. 모델이 비거나 시간이 넘으면 댓글은 흐린 채로 남는다.

## English

Unspoil hides only the part of a story you have not reached. Comments start blurred, and moving your progress forward reveals them on the page with no extra request.

```bash
npm install
npm run build
npm start
```

Open http://127.0.0.1:47821, paste a Groq key in Settings, and load `extension/dist` as an unpacked extension. Copy the connection token from Settings into the popup.

Add a series, set the last episode you finished, then open http://127.0.0.1:47821/demo/. The forum title contains Squid Game and 오징어 게임. The comments are original.

`npm run eval` scores a 30-comment sanity set at progress 5, careful strictness, against a keyword baseline. The table shows up on the Proof screen. Twenty comments are for development and ten are held out.

Images, video, accounts, and cloud sync are out of scope. If the model is unavailable, the line stays blurred.
