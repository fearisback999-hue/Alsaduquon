import type { PipelineContext, StepResult } from "../context";
import { generatedImages, designValidations } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { validateImage } from "@/lib/images/validator";
import { upscaleForPrint, postProcessForPrint } from "@/lib/images/upscaler";
import { uploadImageBuffer } from "@/lib/images/storage";

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped validation" };
  }

  // Get generated images that need validation
  const images = context.generatedImageIds.length > 0
    ? await context.db.select().from(generatedImages).where(inArray(generatedImages.id, context.generatedImageIds)).all()
    : await context.db.select().from(generatedImages).where(eq(generatedImages.status, "generated")).all();

  if (images.length === 0) {
    return { status: "completed", message: "No images to validate" };
  }

  let passed = 0;
  let failed = 0;
  let infraErrors = 0;
  const errorSamples: string[] = [];
  const recordError = (msg: string) => { if (errorSamples.length < 5) errorSamples.push(msg); };

  for (const image of images) {
    // An image marked "generated" with no blob URL can't be validated. Leave it
    // as-is (recoverable) and record the problem rather than fetch(undefined).
    if (!image.storageUrl) {
      infraErrors++;
      recordError(`image ${image.id}: missing storageUrl`);
      await context.db.update(generatedImages).set({
        errorMessage: "No storageUrl — blob persistence likely failed in Step 04",
      }).where(eq(generatedImages.id, image.id));
      failed++;
      continue;
    }

    try {
      // Download from Vercel Blob
      const response = await fetch(image.storageUrl);
      if (!response.ok) {
        throw new Error(`Blob fetch returned ${response.status} for ${image.storageUrl}`);
      }
      const rawBuffer = Buffer.from(await response.arrayBuffer());

      // Post-process: reduce AI artifacts
      const processedBuffer = await postProcessForPrint(rawBuffer);

      // Upscale to print-ready dimensions — uses Real-ESRGAN when REPLICATE_API_TOKEN
      // is set, falling back to sharp interpolation if it fails.
      const upscaled = await upscaleForPrint(processedBuffer, 4500, 5400, {
        sourceUrl: image.storageUrl ?? undefined,
      });

      // Upload the upscaled version back to Blob
      const stored = await uploadImageBuffer(
        upscaled.buffer,
        `designs/upscaled/${image.id}-print-ready.png`,
      );

      // Update image with upscaled URL
      await context.db.update(generatedImages).set({
        storageUrl: stored.url,
        storagePath: stored.pathname,
      }).where(eq(generatedImages.id, image.id));

      // Validate the upscaled image
      const validation = await validateImage(upscaled.buffer);

      // Record validation
      await context.db.insert(designValidations).values({
        generatedImageId: image.id,
        width: validation.details.width,
        height: validation.details.height,
        dpiValue: validation.details.dpi,
        format: validation.details.format,
        colorMode: validation.details.colorMode,
        fileSizeBytes: validation.details.fileSizeBytes,
        dimensionsPass: validation.checks.dimensions,
        dpiPass: validation.checks.dpi,
        formatPass: validation.checks.format,
        colorModePass: validation.checks.colorMode,
        fileSizePass: validation.checks.fileSize,
        overallPass: validation.passed,
        failureReasons: validation.failures.length > 0 ? JSON.stringify(validation.failures) : null,
      });

      // Update image status
      await context.db.update(generatedImages).set({
        status: validation.passed ? "validated" : "rejected",
      }).where(eq(generatedImages.id, image.id));

      if (validation.passed) {
        context.validatedImageIds.push(image.id);
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      // This is an INFRASTRUCTURE error (blob fetch, sharp, upscale, upload) —
      // NOT a genuine "image is bad" rejection. Keep the image at "generated"
      // status so a re-run can retry it once the infra issue is fixed, instead
      // of permanently poisoning it to "rejected" (which the re-query skips).
      const msg = error instanceof Error ? error.message : String(error);
      infraErrors++;
      recordError(`image ${image.id}: ${msg}`);
      await context.db.update(generatedImages).set({
        errorMessage: msg,
      }).where(eq(generatedImages.id, image.id));
      failed++;
    }
  }

  const errorSuffix = errorSamples.length > 0 ? ` — ERRORS: ${errorSamples.join("; ")}` : "";

  // If nothing passed and the failures were infrastructure errors (not genuine
  // quality rejections), fail the step so the run halts visibly. A systemic
  // Blob/upscale/sharp outage shouldn't masquerade as a green "completed".
  if (passed === 0 && images.length > 0 && infraErrors > 0) {
    return {
      status: "failed",
      message: `Validation passed 0 of ${images.length} images — ${infraErrors} infrastructure errors (likely Blob/upscale/sharp)${errorSuffix}`,
      data: { total: images.length, passed, failed, infraErrors, errors: errorSamples },
    };
  }

  return {
    status: "completed",
    message: `Validated ${images.length} images: ${passed} passed, ${failed} failed${errorSuffix}`,
    data: { total: images.length, passed, failed, infraErrors, errors: errorSamples },
  };
}
