<!-- 이미지 모델에 보내는 프롬프트 (원본 P2를 조각으로 나눈 것). `## @이름` 섹션 단위로 나뉘고,
     코드(steps/image.py의 build_image_prompt)가 이번 이미지에 필요한 섹션만 골라 순서대로 붙인 뒤 # Input Data를 붙인다.
     - base: 항상 / closed_front·closed_back·unfolded: 제품 상태에 맞는 1개 / screen: 화면이 보일 때
     - person: 손·인물이 있을 때 / safe_zone: L3일 때 / mood_HOT·mood_WARM·mood_COLD: 입력 무드 1개 / check: 항상 마지막
     수치(모서리 1/30, 비율 0.63·1.29)는 assets/product 공식 사진에서 잰 값. LangChain을 거치지 않으므로 중괄호를 그대로 써도 된다. -->

## @base

You are a senior commercial product photographer for Samsung.com CRM campaigns.
Create ONE photograph of the book-style foldable phone shown in the attached official product images,
staged as described in [Input Data]. Text is added later in HTML.

# References
Each attached image has a caption in [brackets]. Copy the device design (shape, frame, color, details)
from the product images — never their background, framing, number of devices, or layout.
If no product image is attached, output only: "Attach the product reference image."

# Must
1. One continuous photograph filling the whole canvas at the requested aspect ratio.
   No collage, split panels, borders, bars, or blank bands.
2. Exactly one device in the image. No second phone, no mirror copy.
3. No text anywhere: no letters, numbers, logos, or watermarks.
4. The canvas ratio is not the device ratio. Fill the canvas with the scene; the device keeps its own proportion.
5. Shoot the device squarely with a telephoto look (85 mm): no wide-angle distortion, no steep angle,
   vertical edges within 5° of vertical. A device lying flat is shot from directly above.
6. The whole device is inside the frame with breathing room on every side. Props never overlap its outline.
7. Realistic premium product photography — clean, uncluttered, the device is the hero.
   One natural scale cue near it (a hand, cup, notebook, or keyboard).

# Device
- Flat, squared aluminum frame; the long sides are straight all the way to the corners.
- Corners: all four outer corners share one tight radius of about 1/30 of the body height —
  nearly square, much tighter than an ordinary smartphone. Never soft or pill-shaped, never sharp 90°.
  Screen corners follow with a slightly smaller radius.
- Body color exactly [제품 컬러], matte. Light may rim the edges but never changes the body color.
- Fully closed or fully flat open only — never half folded. No stylus.

## @closed_front

# This view: CLOSED, FRONT
- We see the cover screen with a small punch-hole selfie camera at the top center.
  The back and the rear cameras are not visible.
- Proportion of a credit card: upright, width = 0.63 × height; held sideways, height = 0.63 × width.
  Shorter and wider than an ordinary smartphone — never a tall narrow bar.
- Size: 77 mm wide, narrower than an adult palm (about 100 mm).
- Thin, even bezels on all four sides.

## @closed_back

# This view: CLOSED, BACK
- We see the matte back panel and the camera island. The screen faces away:
  no screen, viewfinder, or UI anywhere in the image.
- If someone is taking a photo with it, we stand in front of the lens, looking at the back.
- Proportion of a credit card: upright, width = 0.63 × height; held sideways, height = 0.63 × width.
  Shorter and wider than an ordinary smartphone — never a tall narrow bar.
- Size: 77 mm wide, narrower than an adult palm (about 100 mm).
- Camera island: one vertical capsule with semicircular ends near the top-left corner (upright),
  the SAME matte color as the back, nearly flush — not a glossy black module.
  Inside it: exactly two equal circular lenses stacked vertically, and one small flash dot below them.
  The flash is not a lens. No logo on the back.

## @unfolded

# This view: FULLY UNFOLDED
- One flat slab showing the large inner screen. The back is not visible.
  Not two phones side by side, not a V shape, no visible crease.
- Wider than tall: width = 1.29 × height, close to a 4:3 photo — a small square-ish tablet, not a wide 16:9 tablet.
- Small punch-hole camera near the top right of the screen. Thin, even bezels.
- Size: 158 mm wide, about 1.5 adult palms; held with two hands.

## @screen

# Screen
Show [화면 콘텐츠] as abstract UI: grey placeholder bars, colored blocks, image tiles.
No readable text, numbers, prices, or app/brand logos. Games and videos are generic original scenes.

## @person

# Hands and people
- Natural hands with five fingers, gripping from behind or below.
  Fingers never cover the screen or the device's left and right edges.
- No face: crop below the chin or show only hands and arms. A head turned fully away is fine.

## @safe_zone

# Text area
[Text Safe Zone] stays part of the same scene but visually quiet — soft focus, even light, low detail.
Keep the device out of it.

## @mood_HOT

# Mood: HOT
Intense and immersive. High saturation, deep shadows, neon violet and electric blue accents,
strong contrast, dramatic rim lighting.

## @mood_WARM

# Mood: WARM
Soft, stylish, aspirational. Pastel palette in harmony with the body color, cream and blush tones,
natural soft daylight, gentle shadows.

## @mood_COLD

# Mood: COLD
Calm, efficient, trustworthy. Low saturation, neutral grey, white and charcoal,
diffused even light, minimal shadows, clean orderly composition.

## @check

# Before output
One device · the side named above facing the camera · its own proportion · tight equal corners ·
no text · one continuous photo.
